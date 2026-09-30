/**
 * Board sync for the office GitHub connection (SPEC §4.2, D14; #35): the
 * webhook receiver, the poller, the board cache, FloorRoom summaries and the
 * event bus, wired together.
 *
 * Mode: `webhook` while verified deliveries keep arriving (a delivery within
 * {@link WEBHOOK_LIVE_MS}); the poller then only reconciles every
 * {@link RECONCILE_MS} to catch missed deliveries. Otherwise `polling` at
 * OFFICE_GITHUB_POLL_SECONDS (default 60), or `off` with OFFICE_GITHUB_POLLING=false.
 *
 *   const sync = createGitHubSync({ db, connection, repos, boards: rooms.floors, ... });
 *   mountGitHubSyncRoutes(server.router, { auth, sync });
 *   sync.start();
 *   sync.events.on("pull_request", (e) => ...); // #155
 */
import {
  GITHUB_SYNC_API_PATH,
  GITHUB_WEBHOOK_PATH,
  type GitHubSyncStatus,
} from "@regulus/protocol";
import type { OfficeAuth } from "../auth/auth.ts";
import { forbidden, unauthorized } from "../auth/errors.ts";
import type { Db } from "../db/index.ts";
import { isOfficeManager } from "../floors/access.ts";
import { json, type RouteHandler, type Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import type { FetchFn } from "./api.ts";
import { BoardCache } from "./board-cache.ts";
import { type BoardSink, buildFloorBoard } from "./board-summary.ts";
import type { GitHubConnection } from "./connection.ts";
import { EventApplier } from "./event-apply.ts";
import { GitHubEventBus, type GitHubEventName, type OfficeAppIdentity } from "./events.ts";
import { ensureHookConfig, type HookConfigResult } from "./hook-config.ts";
import { webhookUrlFor } from "./manifest.ts";
import { createPollClient } from "./poll-client.ts";
import { BoardPoller } from "./poller.ts";
import type { RepoAccess } from "./repo-access.ts";
import { DeliveryLog } from "./webhook-deliveries.ts";
import { createWebhookHandler } from "./webhook-route.ts";

export const WEBHOOK_LIVE_MS = 6 * 60 * 60_000;
export const RECONCILE_MS = 10 * 60_000;
const TICK_MS = 15_000;

export interface GitHubSyncDeps {
  db: Db;
  connection: GitHubConnection;
  repos: Pick<RepoAccess, "withRepoCredential">;
  boards: BoardSink;
  publicUrl: string;
  apiBase: string;
  polling: boolean;
  pollIntervalMs: number;
  logger: Logger;
  fetch?: FetchFn;
  now?: () => number;
}

export class GitHubSync {
  readonly events: GitHubEventBus;
  readonly webhookHandler: RouteHandler;
  readonly poller: BoardPoller;
  readonly cache: BoardCache;
  readonly #deps: GitHubSyncDeps;
  readonly #now: () => number;
  readonly #applier: EventApplier;
  readonly #webhookUrl: string | null;
  #hook: HookConfigResult = { state: "unknown", detail: null, slug: null };
  #lastDeliveryAt: number | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running: Promise<void> | null = null;
  #pausedUntil: number | null = null;
  #stopped = true;

  constructor(deps: GitHubSyncDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
    this.#webhookUrl = webhookUrlFor(deps.publicUrl);
    const logger = deps.logger;
    this.events = new GitHubEventBus(logger);
    this.cache = new BoardCache(deps.db);
    this.#applier = new EventApplier({
      cache: this.cache,
      bus: this.events,
      app: () => this.#appIdentity(),
      publish: (floorIds) => this.publish(floorIds),
      installationChanged: () => this.connectionChanged(),
      now: this.#now,
    });
    this.webhookHandler = createWebhookHandler({
      secret: () => deps.connection.webhookSecret(),
      deliveries: new DeliveryLog(deps.db, this.#now),
      apply: (name, payload, id) => {
        this.#applier.webhook(name as GitHubEventName, payload, id);
      },
      verified: () => {
        this.#lastDeliveryAt = this.#now();
      },
      logger,
      now: this.#now,
    });
    this.poller = new BoardPoller({
      cache: this.cache,
      client: createPollClient({ apiBase: deps.apiBase, fetch: deps.fetch, now: this.#now }),
      withToken: (repoId, fn) => deps.repos.withRepoCredential(repoId, (c) => fn(c.token)),
      onBoardChanged: (floorIds) => this.publish(floorIds),
      onChange: (change) => this.#applier.polled(change),
      logger,
      now: this.#now,
    });
  }

  #appIdentity(): OfficeAppIdentity | null {
    const app = this.#deps.connection.app();
    return app ? { appId: app.credentials.appId, slug: this.#hook.slug ?? app.slug } : null;
  }

  get webhooksLive(): boolean {
    return this.#lastDeliveryAt !== null && this.#now() - this.#lastDeliveryAt < WEBHOOK_LIVE_MS;
  }

  /** Republish the board summaries of these floors from the cache. */
  publish(floorIds: readonly string[]): void {
    for (const floorId of new Set(floorIds)) {
      try {
        this.#deps.boards.publishBoard(
          floorId,
          buildFloorBoard(this.#deps.db, floorId, this.#now()),
        );
      } catch (err) {
        this.#deps.logger.error({ err, floorId }, "publishing a floor board failed");
      }
    }
  }

  /** Boot: boards from the cache, the app's webhook config, then the poll loop. */
  start(): void {
    this.#stopped = false;
    this.publish(this.cache.followedRepos().flatMap((r) => r.floorIds));
    void this.#ensureHook();
    this.#schedule(1_000);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** A floor or its repos changed: show its board, and poll new repos soon. */
  floorChanged(floorId: string): void {
    this.publish([floorId]);
    this.#schedule(1_000);
  }

  /** Connected, disconnected, installed or repo selection changed. */
  connectionChanged(): void {
    this.#deps.connection.reset();
    this.poller.resync();
    void this.#ensureHook();
    this.#schedule(1_000);
  }

  async #ensureHook(): Promise<void> {
    try {
      this.#hook = await ensureHookConfig({
        connection: this.#deps.connection,
        api: this.#deps.connection.api,
        webhookUrl: this.#webhookUrl,
      });
      if (this.#hook.state === "updated" || this.#hook.state === "error") {
        this.#deps.logger.info(
          { state: this.#hook.state, detail: this.#hook.detail },
          "github webhook config",
        );
      }
    } catch (err) {
      this.#deps.logger.warn({ err }, "checking the github webhook config failed");
    }
  }

  #schedule(delayMs: number): void {
    if (this.#stopped) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.pollNow()
        .catch((err) => this.#deps.logger.error({ err }, "github poll cycle failed"))
        .finally(() => {
          const wait = this.#pausedUntil
            ? Math.max(this.#pausedUntil - this.#now(), TICK_MS)
            : TICK_MS;
          if (!this.#timer) this.#schedule(wait);
        });
    }, delayMs);
    this.#timer.unref?.();
  }

  /** One poll pass over due repos (the loop calls this; tests call it directly). */
  pollNow(): Promise<void> {
    if (!this.#deps.polling && !this.webhooksLive) return Promise.resolve();
    if (this.#running) return this.#running;
    const interval = this.webhooksLive ? RECONCILE_MS : this.#deps.pollIntervalMs;
    this.#running = this.poller
      .pollOnce(interval)
      .then((r) => {
        this.#pausedUntil = r.pausedUntil;
      })
      .finally(() => {
        this.#running = null;
      });
    return this.#running;
  }

  status(): GitHubSyncStatus {
    return {
      mode: this.webhooksLive ? "webhook" : this.#deps.polling ? "polling" : "off",
      webhookUrl: this.#webhookUrl,
      webhookSecretSet: this.#deps.connection.webhookSecret() !== null,
      hookConfig: { state: this.#hook.state, detail: this.#hook.detail },
      lastDeliveryAt: this.#lastDeliveryAt,
      lastPollAt: this.poller.lastPollAt,
      rateLimitedUntil:
        this.#pausedUntil && this.#pausedUntil > this.#now() ? this.#pausedUntil : null,
      repos: this.cache.followedRepos().length,
    };
  }
}

export function createGitHubSync(deps: GitHubSyncDeps): GitHubSync {
  return new GitHubSync(deps);
}

/** `POST /api/github/webhook` (signature, no session) and `GET /api/github/sync` (owners/admins). */
export function mountGitHubSyncRoutes(
  router: Router,
  deps: { auth: Pick<OfficeAuth, "getSessionFromRequest">; sync: GitHubSync },
): void {
  router.post(GITHUB_WEBHOOK_PATH, deps.sync.webhookHandler);
  router.get(GITHUB_SYNC_API_PATH, async ({ request }) => {
    const user = await deps.auth.getSessionFromRequest(request);
    if (!user) return unauthorized().toResponse();
    if (!isOfficeManager(user.role)) return forbidden("owner_or_admin_required").toResponse();
    return json(deps.sync.status());
  });
}
