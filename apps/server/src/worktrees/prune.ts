/**
 * Worktree garbage collection (admin `prune`): remove agent worktree
 * directories whose agent no longer exists, then `git worktree prune` every
 * clone so git forgets missing worktrees. Branches and humans' clones are
 * left alone: an orphaned branch may hold work nobody pushed.
 *
 * Layout (../runners/layout.ts): `<worktreesDir>/<floor>/<rid>/<agentId>`
 * next to `<rid>/_clones/<repo>`, plus pre-#114 worktrees directly in the
 * floor dir (`<floor>/<agentId>`: not a runner id, or a checkout).
 */
import { readdir, rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { agents, floorRepos } from "../db/schema/index.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import type { Logger } from "../logging.ts";
import { CLONES_DIR } from "../runners/layout.ts";
import { RUNNER_ID } from "../runners/linux-user/ids.ts";
import { gitIn } from "./git-ops.ts";
import type { GitWorktreeWorkspaces } from "./workspaces.ts";

export interface PruneResult {
  /** Orphaned worktree directories removed. */
  removed: string[];
  /** Orphans that could not be removed (e.g. files owned by another account). */
  failed: { path: string; reason: string }[];
  /** Clones `git worktree prune` ran in. */
  repos: number;
}

async function subdirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  } catch {
    return [];
  }
}

async function kind(path: string): Promise<"file" | "dir" | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? "file" : s.isDirectory() ? "dir" : null;
  } catch {
    return null;
  }
}

export async function pruneWorktrees(deps: {
  db: Db;
  repos: RepoAccess;
  workspaces: GitWorktreeWorkspaces;
  worktreesDir: string;
  logger: Logger;
}): Promise<PruneResult> {
  const { db, repos, workspaces, worktreesDir, logger } = deps;
  const result: PruneResult = { removed: [], failed: [], repos: 0 };
  const clones: string[] = [];

  const removeOrphans = async (dir: string, names: string[]) => {
    const live = new Set(
      names.length === 0
        ? []
        : db
            .select({ id: agents.id })
            .from(agents)
            .where(inArray(agents.id, names))
            .all()
            .map((r) => r.id),
    );
    for (const name of names) {
      if (live.has(name) || workspaces.isActive(name)) continue;
      const path = join(dir, name);
      try {
        await rm(path, { recursive: true, force: true });
        result.removed.push(path);
      } catch (err) {
        result.failed.push({ path, reason: (err as NodeJS.ErrnoException).code ?? "error" });
      }
    }
  };

  for (const floorDir of await subdirs(worktreesDir)) {
    const floorPath = join(worktreesDir, floorDir);
    const legacy: string[] = [];
    for (const name of await subdirs(floorPath)) {
      const path = join(floorPath, name);
      if (!RUNNER_ID.test(name) || (await kind(join(path, ".git"))) !== null) {
        legacy.push(name);
        continue;
      }
      // A human's area: their clones stay, orphaned agent worktrees go.
      for (const repo of await subdirs(join(path, CLONES_DIR))) {
        const clone = join(path, CLONES_DIR, repo);
        if ((await kind(join(clone, ".git"))) === "dir") clones.push(clone);
      }
      const agentDirs = (await subdirs(path)).filter((n) => n !== CLONES_DIR);
      await removeOrphans(path, agentDirs);
    }
    await removeOrphans(floorPath, legacy);
    // Drop the floor directory once it is empty; ignore "not empty".
    await rmdir(floorPath).catch(() => undefined);
  }

  // Floor mirrors still own the worktrees of pre-#114 agents.
  const ready = db
    .select({ id: floorRepos.id })
    .from(floorRepos)
    .where(eq(floorRepos.cloneStatus, "ready"))
    .all();
  for (const { id } of ready) {
    const repo = repos.getRepo(id);
    if (repo) clones.push(repo.workdir);
  }
  for (const clone of clones) {
    await workspaces.locks.run(clone, async () => {
      const res = await gitIn(workspaces.ctx(clone), ["worktree", "prune"], { cwd: clone });
      if (res.code === 0) result.repos += 1;
      else logger.warn({ clone, stderr: res.stderr }, "git worktree prune failed");
    });
  }
  logger.info(
    { removed: result.removed.length, failed: result.failed.length, repos: result.repos },
    "worktrees pruned",
  );
  return result;
}
