/**
 * Boot wiring for notifications (#42): the channel store, delivery queue,
 * NotificationCenter and REST routes. The center is handed to the
 * AgentManager as its observer (status changes, PRs opened); the BuildingRoom
 * delivers personal messages; merged robot PRs come from the GitHub event
 * bus (#35 webhooks and polling).
 */
import type { OfficeAuth } from "../auth/auth.ts";
import type { Db } from "../db/index.ts";
import type { GitHubEventBus } from "../github/events.ts";
import type { Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import type { MasterKeyring } from "../secrets/index.ts";
import { NotificationCenter, type PersonalSink } from "./center.ts";
import { ChannelStore } from "./channels.ts";
import { WebhookDispatcher } from "./delivery.ts";
import { NotificationDirectory } from "./directory.ts";
import { notifyMergedPullRequests } from "./pr-merged.ts";
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
  /** Notify robots' owners when their PRs are merged (GitHub event bus, #35). */
  followGitHub(events: Pick<GitHubEventBus, "on">): void;
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
  let unsubscribe: (() => void) | undefined;
  return {
    center,
    mount(router, auth) {
      mountNotificationRoutes(router, { auth, db: deps.db, channels, directory, center, policy });
    },
    followGitHub(events) {
      unsubscribe?.();
      unsubscribe = notifyMergedPullRequests({ db: deps.db, events, center, directory, logger });
    },
    close() {
      unsubscribe?.();
      center.close();
    },
  };
}
