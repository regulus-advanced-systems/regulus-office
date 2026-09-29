/**
 * Boot wiring for the office GitHub connection (#141):
 *
 *   const github = createGitHubConnection({ db, keyring, config, logger });
 *   createFloors({ ..., connection: github.connection });
 *   mountGitHubRoutes(server.router, { auth, db, logger, ...github });
 */
import type { OfficeConfig } from "../config.ts";
import type { Db } from "../db/index.ts";
import type { Logger } from "../logging.ts";
import type { MasterKeyring } from "../secrets/index.ts";
import type { FetchFn } from "./api.ts";
import { parseAppKey } from "./app-auth.ts";
import { GitHubConnection } from "./connection.ts";
import { ConnectionStore } from "./connection-store.ts";
import { ManifestStates } from "./manifest.ts";

export function createGitHubConnection(deps: {
  db: Db;
  keyring: MasterKeyring | undefined;
  config: Pick<OfficeConfig, "githubApiBase" | "githubWebBase" | "githubApp">;
  logger: Logger;
  fetch?: FetchFn;
  now?: () => number;
}): { connection: GitHubConnection; states: ManifestStates; webBase: string } {
  const logger = deps.logger.child({ module: "github" });
  const env = deps.config.githubApp;
  if (env) {
    // Fail at boot with a clear message rather than on the first clone.
    parseAppKey(env.privateKey.expose());
    logger.info({ appId: env.appId }, "office GitHub App configured from the environment");
  }
  const connection = new GitHubConnection({
    store: new ConnectionStore(deps.db, deps.keyring),
    apiBase: deps.config.githubApiBase,
    logger,
    envApp: env
      ? {
          appId: env.appId,
          clientId: env.clientId,
          privateKey: env.privateKey.expose(),
          webhookSecret: env.webhookSecret?.expose() ?? null,
        }
      : undefined,
    fetch: deps.fetch,
    now: deps.now,
  });
  return { connection, states: new ManifestStates(deps.now), webBase: deps.config.githubWebBase };
}
