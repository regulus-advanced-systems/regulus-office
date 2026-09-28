/**
 * Where an agent works (SPEC §8: the floor repo checkout, or a per-agent git
 * worktree under `/srv/office/worktrees/<floor>/<agent>/`).
 *
 * The interface lives in apps/server/src/worktrees/types.ts (#31, git
 * worktrees). {@link RepoWorkspaces} is used when a spawn opts out of a
 * worktree (`autoWorktree: false`): the floor repo checkout on its default
 * branch.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { floorRepos } from "../../db/schema/index.ts";
import type { Workspaces } from "../../worktrees/types.ts";

export type { Workspaces } from "../../worktrees/types.ts";

/** Default: the floor repo's own checkout and default branch; release is a no-op. */
export class RepoWorkspaces implements Workspaces {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async prepare(input: { repoId: string }): Promise<{ workdir: string; branch: string }> {
    const repo = this.#db
      .select({ workdir: floorRepos.workdir, defaultBranch: floorRepos.defaultBranch })
      .from(floorRepos)
      .where(eq(floorRepos.id, input.repoId))
      .get();
    if (!repo) throw new Error("repo not found");
    return { workdir: repo.workdir, branch: repo.defaultBranch };
  }

  async release(): Promise<void> {}
}

/** Branch-name friendly slug from a task title or issue number (for worktree branches). */
export function taskSlug(input: { taskTitle?: string; issueNumber?: number }): string {
  const base = (input.taskTitle ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (input.issueNumber)
    return base ? `${input.issueNumber}-${base}` : `issue-${input.issueNumber}`;
  return base || "task";
}
