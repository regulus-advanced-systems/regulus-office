/**
 * Clones floor repos in the background (SPEC §8): `floor_repos.cloneStatus`
 * goes `cloning` → `ready` (with the default branch recorded) or `error`
 * (with a redacted reason). A clone lands in a temporary sibling directory
 * and is renamed into place, so a half-finished clone never looks ready.
 * Repos still `cloning` at boot are picked up again by `resumePending`.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { floorRepos } from "../db/schema/index.ts";
import { RepoCredentialError } from "../github/credentials.ts";
import { type GitRunner, redactGitOutput, runGit, summarizeGitError } from "../github/git.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import type { Logger } from "../logging.ts";

export interface RepoClonerDeps {
  db: Db;
  repos: RepoAccess;
  logger: Logger;
  git?: GitRunner;
  /** Called after a repo settles (ready or error) so rooms can refresh. */
  onSettled?(floorId: string, repoId: string): void;
  /** Clones running at once. */
  concurrency?: number;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const CREDENTIAL_MESSAGES: Record<RepoCredentialError["code"], string> = {
  master_key_missing: "OFFICE_MASTER_KEY is not set, so the stored access token cannot be used",
  undecryptable: "the stored access token could not be decrypted; enter it again",
};

export class RepoCloner {
  readonly #deps: RepoClonerDeps;
  readonly #git: GitRunner;
  readonly #inFlight = new Map<string, Promise<void>>();
  readonly #waiting: Array<() => void> = [];
  #running = 0;

  constructor(deps: RepoClonerDeps) {
    this.#deps = deps;
    this.#git = deps.git ?? runGit;
  }

  /** Start (or join) the clone of `repoId`; resolves once it settled. Never rejects. */
  enqueue(repoId: string): Promise<void> {
    const existing = this.#inFlight.get(repoId);
    if (existing) return existing;
    const job = this.#withSlot(() => this.#clone(repoId)).finally(() =>
      this.#inFlight.delete(repoId),
    );
    this.#inFlight.set(repoId, job);
    return job;
  }

  /** Re-run clones interrupted by a restart. */
  resumePending(): Promise<void> {
    const pending = this.#deps.db
      .select({ id: floorRepos.id })
      .from(floorRepos)
      .where(eq(floorRepos.cloneStatus, "cloning"))
      .all();
    return Promise.all(pending.map((r) => this.enqueue(r.id))).then(() => undefined);
  }

  /** Resolves when no clone is running (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.#inFlight.size > 0) await Promise.all([...this.#inFlight.values()]);
  }

  async #withSlot(fn: () => Promise<void>): Promise<void> {
    const limit = this.#deps.concurrency ?? 2;
    if (this.#running >= limit) await new Promise<void>((r) => this.#waiting.push(r));
    this.#running += 1;
    try {
      await fn();
    } finally {
      this.#running -= 1;
      this.#waiting.shift()?.();
    }
  }

  #settle(repoId: string, floorId: string, patch: Partial<typeof floorRepos.$inferInsert>) {
    this.#deps.db.update(floorRepos).set(patch).where(eq(floorRepos.id, repoId)).run();
    this.#deps.onSettled?.(floorId, repoId);
  }

  async #clone(repoId: string): Promise<void> {
    const { repos, logger } = this.#deps;
    const repo = repos.getRepo(repoId);
    if (!repo) return;
    const log = logger.child({ repoId, floorId: repo.floorId, repo: `${repo.owner}/${repo.name}` });
    try {
      await repos.withRepoCredential(repoId, async ({ token, redact }) => {
        const { workdir, remoteUrl } = repo;
        if (!(await exists(join(workdir, ".git")))) {
          if (await exists(workdir)) {
            throw new CloneFailure(`${workdir} already exists and is not a git clone`);
          }
          await mkdir(dirname(workdir), { recursive: true });
          const partial = `${workdir}.partial-${randomUUID().slice(0, 8)}`;
          log.info({ workdir }, "cloning floor repo");
          const result = await this.#git(["clone", "--quiet", "--", remoteUrl, partial], { token });
          if (result.code !== 0) {
            await rm(partial, { recursive: true, force: true });
            throw new CloneFailure(summarizeGitError(result.stderr, [token]));
          }
          await rename(partial, workdir);
        }
        const head = await this.#git(["symbolic-ref", "--short", "HEAD"], { cwd: workdir });
        const defaultBranch = head.code === 0 ? head.stdout.trim() || "main" : "main";
        this.#settle(repoId, repo.floorId, {
          cloneStatus: "ready",
          cloneError: null,
          defaultBranch,
        });
        log.info({ defaultBranch }, redact("floor repo ready"));
      });
    } catch (err) {
      let message: string;
      if (err instanceof CloneFailure) message = err.message;
      else if (err instanceof RepoCredentialError) message = CREDENTIAL_MESSAGES[err.code];
      else {
        // Filesystem errors (permissions, disk full): paths only, no credential material.
        const reason = err instanceof Error ? err.message : String(err);
        message = `clone failed: ${redactGitOutput(reason).slice(0, 500)}`;
      }
      log.warn({ reason: message }, "floor repo clone failed");
      this.#settle(repoId, repo.floorId, { cloneStatus: "error", cloneError: message });
    }
  }
}

/** A clone failure whose message is already redacted and fit for clients. */
class CloneFailure extends Error {
  override name = "CloneFailure";
}
