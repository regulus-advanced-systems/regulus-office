/**
 * Worktree garbage collection (admin `prune`): remove worktree directories
 * under `<worktreesDir>/<floor>/<agentId>` whose agent no longer exists, then
 * `git worktree prune` every ready clone so git forgets missing worktrees.
 * Branches are left alone: an orphaned branch may hold work nobody pushed.
 */
import { readdir, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { agents, floorRepos } from "../db/schema/index.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import type { Logger } from "../logging.ts";
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

export async function pruneWorktrees(deps: {
  db: Db;
  repos: RepoAccess;
  workspaces: GitWorktreeWorkspaces;
  worktreesDir: string;
  logger: Logger;
}): Promise<PruneResult> {
  const { db, repos, workspaces, worktreesDir, logger } = deps;
  const result: PruneResult = { removed: [], failed: [], repos: 0 };

  for (const floorDir of await subdirs(worktreesDir)) {
    const floorPath = join(worktreesDir, floorDir);
    const names = await subdirs(floorPath);
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
      const path = join(floorPath, name);
      try {
        await rm(path, { recursive: true, force: true });
        result.removed.push(path);
      } catch (err) {
        result.failed.push({ path, reason: (err as NodeJS.ErrnoException).code ?? "error" });
      }
    }
    // Drop the floor directory once it is empty; ignore "not empty".
    await rmdir(floorPath).catch(() => undefined);
  }

  const ready = db
    .select({ id: floorRepos.id })
    .from(floorRepos)
    .where(eq(floorRepos.cloneStatus, "ready"))
    .all();
  for (const { id } of ready) {
    const repo = repos.getRepo(id);
    if (!repo) continue;
    await workspaces.locks.run(id, async () => {
      const res = await gitIn(workspaces.ctx(repo), ["worktree", "prune"], { cwd: repo.workdir });
      if (res.code === 0) result.repos += 1;
      else logger.warn({ repoId: id, stderr: res.stderr }, "git worktree prune failed");
    });
  }
  logger.info(
    { removed: result.removed.length, failed: result.failed.length, repos: result.repos },
    "worktrees pruned",
  );
  return result;
}
