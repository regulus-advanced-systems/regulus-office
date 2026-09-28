/**
 * GitHub integration (SPEC §4.3 `github/`, D14). M1: repo references, the
 * floor repo project credential (fine-grained PAT fallback), server-side
 * git, and the pull request REST client for the one-click PR. The GitHub App, sync and webhooks arrive in M2.
 */
export {
  REPO_CREDENTIAL_SECRET_NAME,
  RepoCredentialError,
  RepoCredentialVault,
  repoCredentialContext,
} from "./credentials.ts";
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
