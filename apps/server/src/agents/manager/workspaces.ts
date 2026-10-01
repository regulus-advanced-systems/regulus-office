/**
 * Where an agent works (SPEC §8 as amended in #114: a per-agent git worktree
 * of its owner's own clone, `<worktrees>/<operation>/<rid>/<agent>`, or that
 * clone itself when a spawn opts out of a worktree).
 *
 * The interfaces live in apps/server/src/worktrees/types.ts (#31, #114):
 * `Workspaces` and `HumanClones`, both implemented by the worktrees module.
 * {@link RepoWorkspaces} is only the fallback when no `HumanClones` is wired
 * (tests): the operation repo checkout on its default branch.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { operationRepos } from "../../db/schema/index.ts";
import type { Workspaces } from "../../worktrees/types.ts";

export type { Workspaces } from "../../worktrees/types.ts";

/** Default: the operation repo's own checkout and default branch; release is a no-op. */
export class RepoWorkspaces implements Workspaces {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async prepare(input: { repoId: string }): Promise<{ workdir: string; branch: string }> {
    const repo = this.#db
      .select({ workdir: operationRepos.workdir, defaultBranch: operationRepos.defaultBranch })
      .from(operationRepos)
      .where(eq(operationRepos.id, input.repoId))
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
