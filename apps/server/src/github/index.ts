/**
 * GitHub integration (SPEC §4.3 `github/`, D14). M1: repo references, the
 * floor repo project credential (per-repo fine-grained PAT), the office
 * GitHub connection (#141: a GitHub App from the manifest flow or an org PAT,
 * with installation tokens and the repo list for "Add floor"), server-side
 * git, and the pull request REST client for the one-click PR. M2 (#35):
 * signed webhooks, polling, the issue/PR board cache, FloorRoom board
 * summaries and the typed event bus that workflows (#155) subscribe to.
 */
export { GitHubConnection } from "./connection.ts";
export { ConnectionStore } from "./connection-store.ts";
export {
  REPO_CREDENTIAL_SECRET_NAME,
  RepoCredentialError,
  RepoCredentialVault,
  repoCredentialContext,
} from "./credentials.ts";
export {
  type AnyGitHubEvent,
  type GitHubEvent,
  GitHubEventBus,
  type GitHubEventName,
  type GitHubEventPayloads,
} from "./events.ts";
export {
  basicAuthHeader,
  DEFAULT_GIT_TIMEOUT_MS,
  type GitResult,
  type GitRunner,
  type GitRunOptions,
  gitAuthEnv,
  gitBaseEnv,
  redactGitOutput,
  runGit,
  summarizeGitError,
} from "./git.ts";
export {
  type CreatePullInput,
  type CreatePullResult,
  createPullRequestClient,
  GITHUB_API_VERSION,
  GitHubApiError,
  type PullRequestClient,
  type PullRequestRef,
} from "./pulls.ts";
export {
  type ConnectionTokens,
  createRepoAccess,
  type RepoAccess,
  type RepoCheckout,
  type RepoCredential,
  RepoNotFoundError,
} from "./repo-access.ts";
export {
  parseRepoRef,
  type RepoRef,
  type RepoRefError,
  type RepoRefResult,
  repoKey,
  repoRemoteUrl,
  repoWebUrl,
} from "./repo-ref.ts";
export { mountGitHubRoutes } from "./routes.ts";
export { createGitHubConnection } from "./setup.ts";
export { createGitHubSync, GitHubSync, mountGitHubSyncRoutes } from "./sync.ts";
