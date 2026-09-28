/**
 * Colyseus' Bun WebSocket transport, embedded in the office `Bun.serve`
 * instead of opening its own listener (SPEC §4.1: one process, one socket).
 *
 * `BunWebSockets.listen()` would call `Bun.serve` itself; this subclass keeps
 * everything else (client wrapper, seat consumption, error codes) and exposes
 * the `fetch` and `websocket` halves for the office server to mount.
 */

import { BunWebSockets, type TransportOptions } from "@colyseus/bun-websockets";
import { type AuthContext, createAuthContext, matchMaker, type Router } from "@colyseus/core";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import type { Logger } from "../../logging.ts";
import { isOriginAllowed } from "../origin.ts";
import { type HttpAttachment, UPGRADED } from "../transport.ts";

/** Shape `BunWebSockets.onConnection` expects on `ws.data` (not exported upstream). */
interface WebSocketData {
  url: string;
  searchParams: URLSearchParams;
  headers: Headers;
  remoteAddress: string;
  context?: AuthContext;
}

export interface EmbeddedTransportOptions {
  logger: Logger;
  /** Origins allowed to matchmake and upgrade; see ../origin.ts. */
  allowedOrigins: readonly string[];
  /** Largest inbound WebSocket frame in bytes. */
  maxPayloadLength?: number;
}

/** Path of a room connection: `/<processId>/<roomId>`. */
const ROOM_PATH = /^\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/;

export class EmbeddedBunWebSockets extends BunWebSockets {
  readonly #logger: Logger;
  readonly #allowedOrigins: readonly string[];
  #router: Router | undefined;
  #listening = false;

  constructor(options: EmbeddedTransportOptions) {
    const wsOptions: TransportOptions = { maxPayloadLength: options.maxPayloadLength ?? 16 * 1024 };
    super(wsOptions);
    this.#logger = options.logger;
    this.#allowedOrigins = options.allowedOrigins;
  }

  /** Called by `Server.listen()`; the office server already owns the socket. */
  override listen(
    _port: number,
    _hostname?: string,
    _backlog?: number,
    listeningListener?: () => void,
  ): this {
    this.#listening = true;
    listeningListener?.();
    return this;
  }

  override bindRouter(router: Router): void {
    this.#router = router;
  }

  override shutdown(): void {
    this.#listening = false;
    for (const ws of [...this.clients]) ws.close(1001, "server shutdown");
  }

  get listening(): boolean {
    return this.#listening;
  }

  /** Handlers for the office `Bun.serve`. */
  get attachment(): HttpAttachment {
    return { fetch: this.#fetch, websocket: this.#websocket as WebSocketHandler<unknown> };
  }

  #fetch = async (
    request: Request,
    url: URL,
    server: Server<unknown>,
  ): Promise<Response | typeof UPGRADED | undefined> => {
    const isUpgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket";
    const isMatchmake = url.pathname.startsWith(`/${matchMaker.controller.matchmakeRoute}/`);
    if (!isUpgrade && !isMatchmake) return undefined;

    const origin = request.headers.get("origin");
    if (!isOriginAllowed(origin, this.#allowedOrigins)) {
      this.#logger.warn({ origin, path: url.pathname }, "rejected cross-origin room request");
      return new Response(null, { status: 403 });
    }

    if (isUpgrade) {
      if (!ROOM_PATH.test(url.pathname)) return undefined;
      const remoteAddress = server.requestIP(request)?.address ?? "unknown";
      const data: WebSocketData = {
        url: url.pathname,
        searchParams: url.searchParams,
        headers: request.headers,
        remoteAddress,
        context: createAuthContext({
          headers: request.headers,
          token: url.searchParams.get("_authToken"),
          remoteAddress,
        }),
      };
      return (server as Server<WebSocketData>).upgrade(request, { data }) ? UPGRADED : undefined;
    }

    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!this.#listening || !this.#router) {
      return Response.json({ error: "rooms_unavailable" }, { status: 503, headers: cors });
    }
    if (this.#router.findRoute(request.method, url.pathname) === undefined) return undefined;
    const response = await this.#router.handler(request);
    for (const [k, v] of Object.entries(cors))
      if (!response.headers.has(k)) response.headers.set(k, v);
    return response;
  };

  #websocket: WebSocketHandler<WebSocketData> = {
    open: async (ws) => {
      await this.onConnection(ws as ServerWebSocket<WebSocketData>);
    },
    message: (ws, message) => {
      const bytes = typeof message === "string" ? Buffer.from(message) : Buffer.from(message);
      this.clientWrappers.get(ws as ServerWebSocket<WebSocketData>)?.emit("message", bytes);
    },
    close: (ws, code) => {
      const raw = ws as ServerWebSocket<WebSocketData>;
      const i = this.clients.indexOf(raw);
      if (i >= 0) this.clients.splice(i, 1);
      const wrapper = this.clientWrappers.get(raw);
      if (wrapper) {
        this.clientWrappers.delete(raw);
        wrapper.emit("close", code);
      }
    },
  };
}

/** CORS for the matchmaking endpoint; only reached for an allowed (or absent) origin. */
function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type, authorization, x-office-dev-user",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "origin",
  };
}
