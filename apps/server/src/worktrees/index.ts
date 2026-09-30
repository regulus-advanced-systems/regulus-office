/**
 * Per-agent git worktrees, cleanup, prune and the one-click PR (#31;
 * SPEC §6 `agent.pr`, §8, §10 M1).
 *
 * Boot wiring:
 *   const worktrees = createWorktrees({ db, logger, config, repos: floors.repos, runner });
 *   mountWorktreeRoutes(server.router, { auth, db, prune: worktrees.prune });
 * The AgentManager (#26) uses `worktrees.workspaces` ({@link Workspaces});
 * the `agent.pr` command and button (#33) call `worktrees.openPullRequest`.
 */
import type { OfficeConfig } from "../config.ts";
import type { Db } from "../db/index.ts";
import type { GitRunner } from "../github/git.ts";
import { createPullRequestClient, type PullRequestClient } from "../github/pulls.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import type { Logger } from "../logging.ts";
import type { Runner } from "../runners/types.ts";
import { KeyedMutex } from "./git-ops.ts";
import { type PruneResult, pruneWorktrees } from "./prune.ts";
import {
  type OpenedPullRequest,
  type OpenPullRequestOptions,
  PullRequestService,
} from "./pull-request.ts";
import { GitWorktreeWorkspaces } from "./workspaces.ts";

export {
  type FloorDirRemover,
  floorDirRemover,
  OfficeFloorDirRemover,
} from "./floor-dirs.ts";
export { agentGitEnv, BRANCH_PREFIX, branchSlug } from "./git-ops.ts";
export { type LegacyLayoutDeps, migrateLegacyLayout } from "./migrate.ts";
export type { PruneResult } from "./prune.ts";
export {
  draftBody,
  draftTitle,
  type OpenedPullRequest,
  type OpenPullRequestOptions,
} from "./pull-request.ts";
export { mountWorktreeRoutes, WORKTREES_PRUNE_PATH } from "./routes.ts";
export * from "./types.ts";
export { GitWorktreeWorkspaces, type WorkspaceStatus } from "./workspaces.ts";

export interface WorktreesDeps {
  db: Db;
  logger: Logger;
  config: Pick<OfficeConfig, "worktreesDir" | "githubApiBase">;
  repos: RepoAccess;
  runner?: Pick<Runner, "mountProject">;
  git?: GitRunner;
  github?: PullRequestClient;
}

export interface Worktrees {
  workspaces: GitWorktreeWorkspaces;
  openPullRequest(agentId: string, options?: OpenPullRequestOptions): Promise<OpenedPullRequest>;
  prune(): Promise<PruneResult>;
}

export function createWorktrees(deps: WorktreesDeps): Worktrees {
  const logger = deps.logger.child({ module: "worktrees" });
  const workspaces = new GitWorktreeWorkspaces({
    db: deps.db,
    repos: deps.repos,
    worktreesDir: deps.config.worktreesDir,
    logger,
    runner: deps.runner,
    git: deps.git,
    locks: new KeyedMutex(),
  });
  const prs = new PullRequestService({
    db: deps.db,
    repos: deps.repos,
    workspaces,
    github: deps.github ?? createPullRequestClient({ apiBase: deps.config.githubApiBase }),
    logger,
  });
  return {
    workspaces,
    openPullRequest: (agentId, options) => prs.openPullRequest(agentId, options),
    prune: () =>
      pruneWorktrees({
        db: deps.db,
        repos: deps.repos,
        workspaces,
        worktreesDir: deps.config.worktreesDir,
        logger,
      }),
  };
}
