/**
 * Boot wiring for notifications (#42): the channel store, delivery queue,
 * NotificationCenter and REST routes. The center is handed to the
 * AgentManager as its observer (status changes, PRs opened); the BuildingRoom
 * delivers personal messages; the PR watcher starts once repos are known.
 */
import type { OfficeAuth } from "../auth/auth.ts";
import type { Db } from "../db/index.ts";
import type { RepoAccess } from "../github/repo-access.ts";
import type { Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import type { MasterKeyring } from "../secrets/index.ts";
import { NotificationCenter, type PersonalSink } from "./center.ts";
import { ChannelStore } from "./channels.ts";
import { WebhookDispatcher } from "./delivery.ts";
import { NotificationDirectory } from "./directory.ts";
import { PrWatcher } from "./pr-watch.ts";
import { mountNotificationRoutes } from "./routes.ts";
import { DEFAULT_SENDER_POLICY, type SenderPolicy } from "./senders.ts";

export interface NotificationsDeps {
  db: Db;
  keyring: MasterKeyring | undefined;
  logger: Logger;
  config: { githubApiBase: string; githubWebBase: string };
  personal: PersonalSink;
  policy?: Partial<SenderPolicy>;
}

export interface Notifications {
  center: NotificationCenter;
  mount(
    router: Router,
    auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">,
  ): void;
  /** Poll robots' PRs for merges with the floor repos' credentials. */
  watchPullRequests(repos: Pick<RepoAccess, "withRepoCredential">): void;
  close(): void;
}

export function createNotifications(deps: NotificationsDeps): Notifications {
  const logger = deps.logger.child({ component: "notifications" });
  const policy: SenderPolicy = { ...DEFAULT_SENDER_POLICY, ...deps.policy };
  const channels = new ChannelStore(deps.db, deps.keyring);
  const directory = new NotificationDirectory(deps.db, deps.config.githubWebBase);
  const dispatcher = new WebhookDispatcher({
    policy,
    logger,
    onResult: (channelId, result) => {
      try {
        channels.recordResult(channelId, result.ok, result.code, new Date());
      } catch {
        // The channel was deleted meanwhile.
      }
    },
  });
  const center = new NotificationCenter({
    directory,
    channels,
    dispatcher,
    logger,
    personal: deps.personal,
  });
  let watcher: PrWatcher | undefined;
  return {
    center,
    mount(router, auth) {
      mountNotificationRoutes(router, { auth, db: deps.db, channels, directory, center, policy });
    },
    watchPullRequests(repos) {
      watcher = new PrWatcher({
        db: deps.db,
        repos,
        center,
        directory,
        apiBase: deps.config.githubApiBase,
        logger,
      });
      watcher.start();
    },
    close() {
      watcher?.stop();
      center.close();
    },
  };
}
