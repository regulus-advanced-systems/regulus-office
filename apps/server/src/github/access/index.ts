/**
 * Boot wiring for people's GitHub access (SPEC D27; #267):
 *
 *   const access = createGitHubAccess({ db, keyring, config, logger });
 *   access.mount(server.router, auth);
 *   auth.onSignIn((userId) => access.refresher.request(userId));
 *   access.refresher.follow(githubSync.events);
 *   access.refresher.start();
 *   access.service.repoPermissionFor(userId, repoId);          // #270
 *   access.service.events.on("access-changed", (e) => ...);    // #244, #270
 *
 * The OAuth client is the office's GitHub sign-in client (GITHUB_CLIENT_ID /
 * GITHUB_CLIENT_SECRET). Set those to the office GitHub App's client id and a
 * client secret generated on the app to get user-to-server tokens bounded by
 * the app's installations; an OAuth App's client works too. Its callback URL
 * must include `<OFFICE_PUBLIC_URL>/api/github/link/callback`.
 */
import type { OfficeAuth } from "../../auth/auth.ts";
import type { OfficeConfig } from "../../config.ts";
import type { Db } from "../../db/index.ts";
import type { Router } from "../../http/router.ts";
import type { Logger } from "../../logging.ts";
import type { MasterKeyring } from "../../secrets/index.ts";
import type { FetchFn } from "../api.ts";
import { ManifestStates } from "../manifest.ts";
import { AccessGitHub } from "./client.ts";
import { AccessRefresher } from "./refresher.ts";
import { mountGitHubLinkRoutes } from "./routes.ts";
import { GitHubAccessService } from "./service.ts";
import { AccessStore } from "./store.ts";

export { AccessGitHub, AccessGitHubError, LINK_SCOPES, type OAuthClient } from "./client.ts";
export {
  type AccessChangedEvent,
  type AccessChangeReason,
  AccessEventBus,
} from "./events.ts";
export { AccessRefresher, DEFAULT_REFRESH_INTERVAL_MS } from "./refresher.ts";
export { mountGitHubLinkRoutes } from "./routes.ts";
export {
  GitHubAccessService,
  LinkError,
  type RefreshOutcome,
  type VisibleLevel,
} from "./service.ts";
export { AccessStore } from "./store.ts";

export interface GitHubAccessDeps {
  db: Db;
  keyring: MasterKeyring | undefined;
  config: Pick<OfficeConfig, "githubApiBase" | "githubWebBase" | "githubOAuth">;
  logger: Logger;
  fetch?: FetchFn;
  now?: () => number;
  refreshIntervalMs?: number;
  debounceMs?: number;
}

export function createGitHubAccess(deps: GitHubAccessDeps) {
  const logger = deps.logger.child({ module: "github-access" });
  const oauth = deps.config.githubOAuth;
  const service = new GitHubAccessService({
    store: new AccessStore(deps.db, deps.keyring),
    github: new AccessGitHub({
      apiBase: deps.config.githubApiBase,
      webBase: deps.config.githubWebBase,
      fetch: deps.fetch,
      now: deps.now,
    }),
    oauthClient: () =>
      oauth ? { clientId: oauth.clientId, clientSecret: oauth.clientSecret.expose() } : null,
    logger,
    now: deps.now,
  });
  const refresher = new AccessRefresher({
    service,
    logger,
    intervalMs: deps.refreshIntervalMs,
    debounceMs: deps.debounceMs,
  });
  const states = new ManifestStates(deps.now);
  return {
    service,
    refresher,
    states,
    mount(
      router: Router,
      auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">,
    ): void {
      mountGitHubLinkRoutes(router, { auth, db: deps.db, service, states, logger, now: deps.now });
    },
  };
}

export type GitHubAccess = ReturnType<typeof createGitHubAccess>;
