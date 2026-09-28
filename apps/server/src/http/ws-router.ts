/**
 * Several WebSocket endpoints behind the one `Bun.serve` (SPEC §4.1, §6):
 * Colyseus rooms, the terminal bridge (`/ws/term/<agentId>`) and later the
 * whiteboard. Bun accepts a single `websocket` handler per server, so this
 * composite asks each attachment in turn to handle a request, remembers on
 * `ws.data` which one upgraded the connection, and dispatches every socket
 * event back to it. Attachments stay unaware of each other.
 */
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import { type HttpAttachment, UPGRADED } from "../rooms/transport.ts";

/** An attachment plus, optionally, a bounded route label for logs and metrics (#90). */
export interface WsRoute extends HttpAttachment {
  /** Router-style pattern (e.g. `/ws/term/:agentId`) when `url` is this route's; never the raw path. */
  routeOf?(url: URL): string | undefined;
}

/** Tag on `ws.data` naming the attachment that upgraded the socket. */
const ROUTE_TAG: unique symbol = Symbol("ws-route");
type Tagged = { [ROUTE_TAG]?: number };

export class WsRouter implements WsRoute {
  readonly #routes: WsRoute[] = [];

  /** Add an attachment; earlier ones get the first look at each request. */
  use(route: WsRoute): this {
    this.#routes.push(route);
    return this;
  }

  routeOf(url: URL): string | undefined {
    for (const route of this.#routes) {
      const label = route.routeOf?.(url);
      if (label) return label;
    }
    return undefined;
  }

  fetch = async (
    request: Request,
    url: URL,
    server: Server<unknown>,
  ): Promise<Response | typeof UPGRADED | undefined> => {
    for (const [index, route] of this.#routes.entries()) {
      const handled = await route.fetch(request, url, tagUpgrades(server, index));
      if (handled !== undefined) return handled;
    }
    return undefined;
  };

  readonly websocket: WebSocketHandler<unknown> = {
    open: (ws) => this.#handler(ws)?.open?.(ws),
    message: (ws, message) => this.#handler(ws)?.message(ws, message),
    drain: (ws) => this.#handler(ws)?.drain?.(ws),
    close: (ws, code, reason) => this.#handler(ws)?.close?.(ws, code, reason),
    ping: (ws, data) => this.#handler(ws)?.ping?.(ws, data),
    pong: (ws, data) => this.#handler(ws)?.pong?.(ws, data),
  };

  #handler(ws: ServerWebSocket<unknown>): WebSocketHandler<unknown> | undefined {
    const index = (ws.data as Tagged | undefined)?.[ROUTE_TAG];
    return index === undefined ? undefined : this.#routes[index]?.websocket;
  }
}

/**
 * The server as seen by one attachment: `upgrade` tags the socket data with
 * the attachment's index (in place, so the attachment keeps its own object);
 * everything else is the real server, bound so native methods keep working.
 */
function tagUpgrades(server: Server<unknown>, index: number): Server<unknown> {
  return new Proxy(server, {
    get(target, prop) {
      if (prop === "upgrade") {
        return (request: Request, options?: { data?: unknown; headers?: HeadersInit }) => {
          const data = (options?.data ?? {}) as Tagged;
          data[ROUTE_TAG] = index;
          return target.upgrade(request, { ...options, data });
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
