/**
 * The changes window's server side (#38): finds a henchman's worktree and runs
 * the look, the per-file views and the owner's actions in its runner.
 *
 * - Looks are shared: every viewer polling the same henchman within `cacheMs`
 *   gets the same result, and one look runs at a time per henchman, so ten
 *   watchers cost the henchman's owner one `git status` every two seconds.
 * - File diffs and image reads are limited per henchman (`maxReads` at once).
 * - Commit and discard run one at a time per henchman, each on a fresh look.
 *
 * Authorisation is the route's job (routes.ts); this layer trusts its caller.
 */
import type { CommitChangesRequest, FileSig, ImageSide } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { agents } from "../db/schema/index.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import type { Runner } from "../runners/types.ts";
import { KeyedMutex } from "../worktrees/git-ops.ts";
import type { HumanClones } from "../worktrees/types.ts";
import { type CommitIdentity, commitFiles, discardFile } from "./actions.ts";
import { HenchmanShell } from "./henchman-shell.ts";
import { ChangesHttpError, checkRepoPath } from "./paths.ts";
import { lookAtWorktree, type WorktreeLook } from "./snapshot.ts";
import { fileDiff, imageBlob } from "./views.ts";

export type AgentRow = typeof agents.$inferSelect;

export interface ChangesServiceDeps {
  db: Db;
  runner: Pick<Runner, "spawnPiped">;
  repos: Pick<RepoAccess, "getRepo">;
  clones: Pick<HumanClones, "cloneFor">;
  now?: () => number;
  /** How long a look is reused (default 1500 ms, under the 2 s poll). */
  cacheMs?: number;
  /** Diff and image reads at once per henchman (default 4). */
  maxReads?: number;
}

interface Cached {
  at: number;
  look: Promise<WorktreeLook>;
}

export class ChangesService {
  readonly #cache = new Map<string, Cached>();
  readonly #reads = new Map<string, number>();
  readonly #locks = new KeyedMutex();

  constructor(private readonly deps: ChangesServiceDeps) {}

  /** The henchman's row, or null when it does not exist. */
  agent(agentId: string): AgentRow | null {
    return this.deps.db.select().from(agents).where(eq(agents.id, agentId)).get() ?? null;
  }

  #shell(row: AgentRow): { shell: HenchmanShell; baseRef: string } {
    const repo = this.deps.repos.getRepo(row.repoId);
    if (!repo) throw new ChangesHttpError(409, "unavailable", "the henchman's repo is gone");
    let clone: string;
    try {
      const found = this.deps.clones.cloneFor(row);
      if (found.legacy) {
        throw new ChangesHttpError(
          409,
          "unavailable",
          "this henchman's workspace predates per-human clones; its runner cannot reach it",
        );
      }
      clone = found.clone;
    } catch (err) {
      if (err instanceof ChangesHttpError) throw err;
      throw new ChangesHttpError(409, "unavailable", "the henchman's workspace cannot be found");
    }
    const shell = new HenchmanShell(this.deps.runner, {
      userId: row.ownerUserId,
      agentId: row.id,
      provider: row.provider,
      workdir: row.workdir,
      clone,
    });
    return { shell, baseRef: `origin/${repo.defaultBranch}` };
  }

  #fresh(row: AgentRow): Promise<WorktreeLook> {
    const { shell, baseRef } = this.#shell(row);
    return lookAtWorktree(shell, baseRef, this.deps.now);
  }

  /** A look at most `cacheMs` old; concurrent callers share one run. */
  look(row: AgentRow): Promise<WorktreeLook> {
    const now = (this.deps.now ?? Date.now)();
    const hit = this.#cache.get(row.id);
    if (hit && now - hit.at < (this.deps.cacheMs ?? 1500)) return hit.look;
    if (this.#cache.size > 256) {
      for (const [id, c] of this.#cache) if (now - c.at > 60_000) this.#cache.delete(id);
    }
    const look = this.#fresh(row);
    const entry = { at: now, look };
    this.#cache.set(row.id, entry);
    look.catch(() => {
      if (this.#cache.get(row.id) === entry) this.#cache.delete(row.id);
    });
    return look;
  }

  async #read<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
    const n = this.#reads.get(agentId) ?? 0;
    if (n >= (this.deps.maxReads ?? 4)) {
      throw new ChangesHttpError(429, "git_busy", "too many reads of this henchman at once");
    }
    this.#reads.set(agentId, n + 1);
    try {
      return await fn();
    } finally {
      const left = (this.#reads.get(agentId) ?? 1) - 1;
      if (left > 0) this.#reads.set(agentId, left);
      else this.#reads.delete(agentId);
    }
  }

  async fileDiff(row: AgentRow, path: string) {
    checkRepoPath(path);
    return this.#read(row.id, async () =>
      fileDiff(this.#shell(row).shell, await this.look(row), path),
    );
  }

  async image(row: AgentRow, path: string, side: ImageSide) {
    checkRepoPath(path);
    return this.#read(row.id, async () =>
      imageBlob(this.#shell(row).shell, await this.look(row), path, side),
    );
  }

  commit(row: AgentRow, req: CommitChangesRequest, identity: CommitIdentity) {
    return this.#locks.run(row.id, async () => {
      try {
        return await commitFiles(this.#shell(row).shell, await this.#fresh(row), req, identity);
      } finally {
        this.#cache.delete(row.id);
      }
    });
  }

  async discard(row: AgentRow, file: FileSig) {
    checkRepoPath(file.path);
    return this.#locks.run(row.id, async () => {
      try {
        await discardFile(this.#shell(row).shell, await this.#fresh(row), file);
      } finally {
        this.#cache.delete(row.id);
      }
    });
  }
}
