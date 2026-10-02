/**
 * Per-agent git worktrees (SPEC §8, §10 M1; research 02 weakness #7).
 *
 * The AgentManager (#26) calls {@link Workspaces}: `prepare` before a spawn
 * (the owner's own clone of the operation repo, fetch, then a fresh
 * `office/<slug>` branch cut from `origin/<default>` in
 * `<worktreesDir>/<operation-slug>/<runner id>/<agentId>`), `release` on
 * send-home. Layout: ../runners/layout.ts (#114).
 */

export interface PrepareWorkspaceInput {
  agentId: string;
  operationId: string;
  repoId: string;
  /** Human-readable agent slug; becomes the branch `office/<slug>` (made unique). */
  slug: string;
  ownerUserId: string;
  /** Start point, a remote branch such as `origin/feature`; `origin/<default>` when absent. */
  base?: string;
}

export interface PreparedWorkspace {
  /** Absolute worktree path (same path inside the runner). */
  workdir: string;
  /** `office/<slug>[-n]`. */
  branch: string;
}

export interface ReleaseWorkspaceInput {
  agentId: string;
  /** False deletes the branch locally and, if it was pushed, on the remote. */
  keepBranch: boolean;
}

export interface Workspaces {
  prepare(input: PrepareWorkspaceInput): Promise<PreparedWorkspace>;
  release(input: ReleaseWorkspaceInput): Promise<void>;
}

/** Where an agent's git lives. */
export interface AgentClone {
  /** The owner's own clone, or the shared operation mirror for a `legacy` workspace. */
  clone: string;
  /** A workspace from before #114, inside the shared mirror: office-side git only, no runner. */
  legacy: boolean;
}

/** Each human's own clone of an operation repo (#114). */
export interface HumanClones {
  /** `autoWorktree: false`: the owner's own clone (made on first use) on the default branch. */
  prepareClone(input: PrepareWorkspaceInput): Promise<PreparedWorkspace>;
  cloneFor(agent: { ownerUserId: string; repoId: string; workdir: string }): AgentClone;
}

/** Why a pre-#114 agent is offline and cannot be resumed (shown to humans). */
export const LEGACY_WORKSPACE_MESSAGE =
  "this henchman's workspace is in the operation's shared clone, which runners can no longer use " +
  "(each human now has their own clone): open its PR or send it home, then spawn a new henchman";

export type WorkspaceErrorCode =
  | "agent_not_found"
  | "repo_not_found"
  | "repo_not_ready"
  | "no_worktree"
  | "fetch_failed"
  | "worktree_failed"
  | "legacy_workspace"
  | "uncommitted_changes"
  | "no_commits"
  | "no_repo_credential"
  | "push_failed"
  | "github_error";

const STATUS: Record<WorkspaceErrorCode, number> = {
  agent_not_found: 404,
  repo_not_found: 404,
  repo_not_ready: 409,
  no_worktree: 409,
  fetch_failed: 502,
  worktree_failed: 500,
  legacy_workspace: 409,
  uncommitted_changes: 409,
  no_commits: 409,
  no_repo_credential: 409,
  push_failed: 502,
  github_error: 502,
};

/**
 * A workspace operation failed. `message` is redacted and fit for clients;
 * `files` lists uncommitted paths for `uncommitted_changes`.
 */
export class WorkspaceError extends Error {
  override name = "WorkspaceError";
  readonly status: number;
  constructor(
    readonly code: WorkspaceErrorCode,
    message: string = code,
    readonly files: readonly string[] = [],
  ) {
    super(message);
    this.status = STATUS[code];
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      ...(this.files.length > 0 ? { files: this.files } : {}),
    };
  }
}
