/**
 * Laptop screen feed (SPEC §9.4, #25): `/ws/screens/<floorId>`.
 *
 * The terminal bridge gives one viewer a live PTY; the other laptops on a
 * floor only need a ~2 fps picture. One socket per floor carries the visible
 * pane text of every robot there (see protocol `terminal-screens.ts`), backed
 * by one shared {@link ScreenPoller} per floor that runs only while someone
 * is subscribed.
 *
 * Checked on upgrade like the bridge: Origin, session cookie, then the
 * terminal `watch` rule (D12: anyone who can see the floor may watch its
 * robots). Nothing a client sends is acted on.
 */
import { SCREEN_FEED_INTERVAL_MS, SCREENS_WS_PREFIX } from "@regulus/protocol";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import { checkOrigin, type OriginPolicy } from "../auth/origin.ts";
import type { WsRoute } from "../http/ws-router.ts";
import type { Logger } from "../logging.ts";
import { UPGRADED } from "../rooms/transport.ts";
import type { FloorVisibility } from "./acl.ts";
import type { TerminalSessionLookup } from "./bridge.ts";
import { ScreenPoller, type ScreenSubscriber } from "./screen-poller.ts";
import { AGENT_ID_PATTERN, type FloorTerminalTargets } from "./targets.ts";

/** Route label for logs and metrics (#90). */
export const SCREENS_ROUTE = `${SCREENS_WS_PREFIX}:floorId`;

export interface ScreenFeedOptions {
  sources: FloorTerminalTargets;
  sessions: TerminalSessionLookup;
  canViewFloor: FloorVisibility;
  originPolicy: OriginPolicy;
  logger: Logger;
  /** Poll period; never below {@link SCREEN_FEED_INTERVAL_MS} in production. */
  intervalMs?: number;
  idleAfterTicks?: number;
  idleEvery?: number;
  maxBufferedBytes?: number;
}

interface ScreenSocketData {
  floorId: string;
  userId: string;
  subscriber?: ScreenSubscriber;
}

const reject = (status: number, error: string): Response =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export class ScreenFeed implements WsRoute {
  readonly #opts: ScreenFeedOptions;
  readonly #pollers = new Map<string, ScreenPoller>();

  constructor(options: ScreenFeedOptions) {
    this.#opts = options;
  }

  routeOf(url: URL): string | undefined {
    return url.pathname.startsWith(SCREENS_WS_PREFIX) ? SCREENS_ROUTE : undefined;
  }

  /** The floor's poller while it has subscribers (tests, metrics). */
  poller(floorId: string): ScreenPoller | undefined {
    return this.#pollers.get(floorId);
  }

  shutdown(): void {
    for (const poller of this.#pollers.values()) poller.stop();
    this.#pollers.clear();
  }

  fetch = async (
    request: Request,
    url: URL,
    server: Server<unknown>,
  ): Promise<Response | typeof UPGRADED | undefined> => {
    if (!url.pathname.startsWith(SCREENS_WS_PREFIX)) return undefined;
    const log = this.#opts.logger.child({ route: SCREENS_ROUTE });
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return reject(426, "websocket_required");
    }
    const origin = checkOrigin(request, this.#opts.originPolicy.publicUrl, this.#opts.originPolicy);
    if (!origin.ok) {
      log.warn({ origin: origin.origin, reason: origin.reason }, "rejected cross-origin screens");
      return reject(403, "origin_rejected");
    }
    const user = await this.#opts.sessions.getSessionFromRequest(request);
    if (!user) return reject(401, "unauthenticated");
    let floorId: string;
    try {
      floorId = decodeURIComponent(url.pathname.slice(SCREENS_WS_PREFIX.length));
    } catch {
      return reject(404, "not_found");
    }
    // Same visibility as the FloorRoom and the bridge's watch rule; invisible floors are 404.
    if (!AGENT_ID_PATTERN.test(floorId) || !this.#opts.canViewFloor(user, floorId)) {
      return reject(404, "not_found");
    }
    const data: ScreenSocketData = { floorId, userId: user.id };
    if (!server.upgrade(request, { data })) return reject(400, "upgrade_failed");
    return UPGRADED;
  };

  readonly websocket: WebSocketHandler<unknown> = {
    open: (ws) => this.#open(ws as ServerWebSocket<ScreenSocketData>),
    message: () => {},
    close: (ws) => this.#close(ws as ServerWebSocket<ScreenSocketData>),
  };

  #open(ws: ServerWebSocket<ScreenSocketData>): void {
    const { floorId } = ws.data;
    let poller = this.#pollers.get(floorId);
    if (!poller) {
      poller = new ScreenPoller({
        floorId,
        sources: this.#opts.sources,
        logger: this.#opts.logger,
        intervalMs: this.#opts.intervalMs ?? SCREEN_FEED_INTERVAL_MS,
        idleAfterTicks: this.#opts.idleAfterTicks ?? 10,
        idleEvery: this.#opts.idleEvery ?? 4,
        maxBufferedBytes: this.#opts.maxBufferedBytes ?? 1024 * 1024,
      });
      this.#pollers.set(floorId, poller);
    }
    const subscriber: ScreenSubscriber = {
      send: (message) => ws.sendText(JSON.stringify(message)),
      bufferedAmount: () => ws.getBufferedAmount(),
      sent: new Map(),
    };
    ws.data.subscriber = subscriber;
    poller.add(subscriber);
  }

  #close(ws: ServerWebSocket<ScreenSocketData>): void {
    const { floorId, subscriber } = ws.data;
    const poller = this.#pollers.get(floorId);
    if (!poller || !subscriber) return;
    if (poller.remove(subscriber)) this.#pollers.delete(floorId);
  }
}
