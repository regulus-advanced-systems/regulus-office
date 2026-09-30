/**
 * REST shapes for the office's GitHub connection (SPEC §4.2 GitHub, §8, D14;
 * issue #141): one office-level connection, either a GitHub App created with
 * the manifest flow and installed on the org, or an org fine-grained PAT.
 * Floors clone the repos it covers, and "Add floor" lists them.
 *
 * Secrets are write-only: a request may carry a PAT, a response never carries
 * the PAT, the app's private key, its webhook secret or an installation token.
 * Every route is for office owners and admins only.
 */
import { z } from "zod";
import { TimestampMs } from "./common.ts";
import { RepoToken } from "./floors-api.ts";

export const GITHUB_API_PATH = "/api/github";
export const GITHUB_CONNECTION_API_PATH = `${GITHUB_API_PATH}/connection`;
export const GITHUB_REPOS_API_PATH = `${GITHUB_API_PATH}/repos`;
export const GITHUB_PAT_API_PATH = `${GITHUB_API_PATH}/pat`;
export const GITHUB_MANIFEST_API_PATH = `${GITHUB_API_PATH}/app/manifest`;
/** GitHub redirects here with `code` and `state` after the app is created. */
export const GITHUB_MANIFEST_CALLBACK_PATH = `${GITHUB_API_PATH}/app/callback`;
/** GitHub redirects here after the app is installed (the app's setup URL). */
export const GITHUB_APP_SETUP_PATH = `${GITHUB_API_PATH}/app/installed`;
/** Query parameter the office page gets after the manifest flow: `connected` or an error code. */
export const GITHUB_RESULT_PARAM = "github";

export const GITHUB_CONNECTION_KINDS = ["none", "app", "pat"] as const;
export type GitHubConnectionKind = (typeof GITHUB_CONNECTION_KINDS)[number];

/** A GitHub account (user or org) login. */
export const GitHubLogin = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, "not a GitHub account name");

export const GitHubInstallationInfo = z.object({
  installationId: z.number().int().positive(),
  account: z.string().max(100),
  /** `all` or `selected` repos. */
  repositorySelection: z.string().max(20),
});
export type GitHubInstallationInfo = z.infer<typeof GitHubInstallationInfo>;

export const GitHubConnectionStatus = z.object({
  kind: z.enum(GITHUB_CONNECTION_KINDS),
  /** `env`: set by GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY and cannot be changed from the UI. */
  source: z.enum(["db", "env"]).nullable(),
  /** False without OFFICE_MASTER_KEY: nothing can be stored. */
  canStore: z.boolean(),
  app: z
    .object({
      appId: z.number().int().positive(),
      slug: z.string().max(100).nullable(),
      name: z.string().max(100).nullable(),
      /** The app's page on GitHub; `<htmlUrl>/installations/new` installs it. */
      htmlUrl: z.string().max(300).nullable(),
      installUrl: z.string().max(300).nullable(),
      owner: z.string().max(100).nullable(),
      installations: z.array(GitHubInstallationInfo),
      /** Why installations could not be listed (redacted), or null. */
      error: z.string().max(300).nullable(),
    })
    .nullable(),
  pat: z
    .object({
      /** The account the token belongs to, when GitHub reports it. */
      login: z.string().max(100).nullable(),
    })
    .nullable(),
  connectedAt: TimestampMs.nullable(),
});
export type GitHubConnectionStatus = z.infer<typeof GitHubConnectionStatus>;

export const GitHubRepoInfo = z.object({
  owner: z.string().max(100),
  name: z.string().max(100),
  /** `owner/name`, what "Add floor" sends as the repo. */
  fullName: z.string().max(201),
  private: z.boolean(),
  defaultBranch: z.string().max(200),
  /** Last push, or null when GitHub has none. */
  pushedAt: TimestampMs.nullable(),
  description: z.string().max(500).nullable(),
});
export type GitHubRepoInfo = z.infer<typeof GitHubRepoInfo>;

export const GitHubReposResponse = z.object({
  repos: z.array(GitHubRepoInfo),
  /** True when the list was cut at the office's limit. */
  truncated: z.boolean(),
});
export type GitHubReposResponse = z.infer<typeof GitHubReposResponse>;

/** Body of `PUT /api/github/pat`: an org fine-grained PAT (D14 fallback). */
export const ConnectPatRequest = z.object({ token: RepoToken });
export type ConnectPatRequest = z.infer<typeof ConnectPatRequest>;

/** Body of `POST /api/github/app/manifest`: create the app under this org (omit: personal account). */
export const StartManifestRequest = z.object({ org: GitHubLogin.optional() });
export type StartManifestRequest = z.infer<typeof StartManifestRequest>;

/**
 * The browser POSTs `manifest` as a form field to `action` (github.com), which
 * carries the one-time `state` that the callback checks (CSRF).
 */
export const StartManifestResponse = z.object({
  action: z.string().max(500),
  manifest: z.string().max(8000),
});
export type StartManifestResponse = z.infer<typeof StartManifestResponse>;

// ---- Webhooks and board sync (#35) -------------------------------------------

/**
 * GitHub → office webhook deliveries. No session: every delivery must carry a
 * valid `X-Hub-Signature-256` for the app's webhook secret.
 */
export const GITHUB_WEBHOOK_PATH = `${GITHUB_API_PATH}/webhook`;
/** Board sync status (owners and admins). */
export const GITHUB_SYNC_API_PATH = `${GITHUB_API_PATH}/sync`;

/**
 * How the boards are kept fresh: `webhook` once verified deliveries arrive
 * (with a slow reconciliation poll), `polling` (ETag conditional requests)
 * otherwise, `off` without a connection or when OFFICE_GITHUB_SYNC=off.
 */
export const GITHUB_SYNC_MODES = ["webhook", "polling", "off"] as const;
export type GitHubSyncMode = (typeof GITHUB_SYNC_MODES)[number];

/** What the office did about the app's webhook configuration on GitHub. */
export const GITHUB_HOOK_CONFIG_STATES = [
  "not_applicable",
  "unknown",
  "ok",
  "updated",
  "error",
] as const;
export type GitHubHookConfigState = (typeof GITHUB_HOOK_CONFIG_STATES)[number];

export const GitHubSyncStatus = z.object({
  mode: z.enum(GITHUB_SYNC_MODES),
  /** Where GitHub should deliver webhooks, or null when OFFICE_PUBLIC_URL is not public https. */
  webhookUrl: z.string().max(500).nullable(),
  /** True when the office holds a webhook secret (never the secret itself). */
  webhookSecretSet: z.boolean(),
  hookConfig: z.object({
    state: z.enum(GITHUB_HOOK_CONFIG_STATES),
    /** Redacted reason for `error`, or a hint. */
    detail: z.string().max(300).nullable(),
  }),
  lastDeliveryAt: TimestampMs.nullable(),
  lastPollAt: TimestampMs.nullable(),
  /** Polling is paused for GitHub's rate limit until this time. */
  rateLimitedUntil: TimestampMs.nullable(),
  /** Distinct GitHub repos the boards follow. */
  repos: z.number().int().min(0),
});
export type GitHubSyncStatus = z.infer<typeof GitHubSyncStatus>;
