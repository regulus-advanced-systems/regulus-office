/**
 * The services proxy route (SPEC §9.4, #39), a `WsRoute` in front of the rest
 * of the office (http/ws-router.ts) so it sees HTTP and WebSocket upgrades:
 *
 * - `/p/<floorId>/a/<agentId>/port/<n>/…` on the office host. Keyed by robot
 *   as well as floor: with per-robot sandboxes (D18) two robots of one floor
 *   can both serve on 3000, so a port alone names nothing. Session cookie,
 *   floor visibility and the app ACL (access.ts) are checked on every
 *   request. Path mode proxies here, for the robot's owner only; app domain
 *   mode redirects everyone allowed to the app's own origin with a ticket.
 * - `<port>-<agentId>.<OFFICE_SERVICES_DOMAIN>` (app domain mode): the app
 *   cookie, then the same floor and ACL checks, per request.
 *
 * Only services the scanner found listening in that robot's sandbox are
 * proxied, to the address the runner gave for the sandbox (registry.ts); the
 * request never names a host. WebSocket upgrades and unsafe methods need the
 * app's own Origin (the office's in path mode).
 */
import { servicesProxyPath } from "@regulus/protocol";
import type { Server } from "bun";
import { checkOrigin, type OriginPolicy } from "../auth/origin.ts";
import type { WsRoute } from "../http/ws-router.ts";
import type { Logger } from "../logging.ts";
import { UPGRADED } from "../rooms/transport.ts";
import { type AppAccess, type AppUser, decideAppAccess, methodAllowed } from "./access.ts";
import {
  APP_AUTH_PATH,
  type AppDomain,
  type AppTokens,
  appCookieHeader,
  appCookieName,
  appLabel,
  appOrigin,
  parseAppHost,
  safeReturnPath,
} from "./app-domain.ts";
import { isLoopback } from "./discovery.ts";
import {
  appError,
  type ForwardContext,
  forwardHttp,
  requestHeaders,
  upstreamUrl,
} from "./proxy-http.ts";
import { openUpstream, relayHandler } from "./proxy-ws.ts";
import type { ProxyableService, ServiceRegistry } from "./registry.ts";

export const SERVICES_PREFIX = "/p/";
export const SERVICES_ROUTE = "/p/:floorId/a/:agentId/port/:port/*";
export const APP_HOST_ROUTE = "app-host:/*";

const PATH_RE =
  /^\/p\/([A-Za-z0-9_-]{1,128})\/a\/([A-Za-z0-9_-]{1,128})\/port\/([1-9]\d{0,4})(\/.*)?$/;

export interface ServicesRouteOptions {
  registry: ServiceRegistry;
  sessions: { getSessionFromRequest(request: Request): Promise<AppUser | null> };
  /** A user's current role (app domain requests carry only the user id). */
  userById(id: string): AppUser | null;
  canViewFloor(user: AppUser, floorId: string): boolean;
  originPolicy: OriginPolicy;
  /** The office's own port: never a proxy target on loopback. */
  officePort: number;
  appDomain: AppDomain | null;
  tokens: AppTokens;
  logger: Logger;
}

const isUpgrade = (r: Request) => r.headers.get("upgrade")?.toLowerCase() === "websocket";
const isSafe = (m: string) => m === "GET" || m === "HEAD" || m === "OPTIONS";

export function parseServicePath(pathname: string) {
  const m = PATH_RE.exec(pathname);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const port = Number(m[3]);
  if (port > 65_535) return null;
  return { floorId: m[1], agentId: m[2], port, rest: m[4] ?? "" };
}

export class ServicesRoute implements WsRoute {
  readonly #o: ServicesRouteOptions;
  readonly websocket = relayHandler as unknown as import("bun").WebSocketHandler<unknown>;

  constructor(options: ServicesRouteOptions) {
    this.#o = options;
  }

  routeOf(url: URL): string | undefined {
    if (this.#o.appDomain && parseAppHost(this.#o.appDomain, url.hostname)) return APP_HOST_ROUTE;
    return url.pathname.startsWith(SERVICES_PREFIX) ? SERVICES_ROUTE : undefined;
  }

  fetch = async (
    request: Request,
    url: URL,
    server: Server<unknown>,
  ): Promise<Response | typeof UPGRADED | undefined> => {
    const d = this.#o.appDomain;
    const app = d ? parseAppHost(d, url.hostname) : null;
    if (d && app) return this.#appHost(request, url, server, d, app);
    if (!url.pathname.startsWith(SERVICES_PREFIX)) return undefined;
    return this.#officePath(request, url, server);
  };

  async #officePath(request: Request, url: URL, server: Server<unknown>) {
    const p = parseServicePath(url.pathname);
    if (!p) return appError(404, "No such app.");
    const prefix = servicesProxyPath(p.floorId, p.agentId, p.port);
    if (!p.rest) return redirect(`${prefix}${url.search}`);
    const policy = this.#o.originPolicy;
    if (isUpgrade(request) || !isSafe(request.method)) {
      const origin = checkOrigin(request, policy.publicUrl, {
        ...policy,
        requireOrigin: isUpgrade(request),
      });
      if (!origin.ok) return appError(403, "Cross-origin request refused.");
    }
    const user = await this.#o.sessions.getSessionFromRequest(request);
    if (!user) return appError(401, "Sign in to the office to open this app.");
    const svc = this.#service(p.agentId, p.port);
    if (!svc || svc.floorId !== p.floorId) return appError(404, "No such app.");
    const d = this.#o.appDomain;
    const label = d ? appLabel(p.agentId, p.port) : null;
    const decision = decideAppAccess(user, svc, this.#o.canViewFloor, Boolean(label));
    if (!decision.ok) return this.#denied(decision.reason, user, svc);
    const unreachable = this.#unreachable(svc);
    if (unreachable) return unreachable;
    if (d && label) {
      // App domain mode: the app never runs on the office origin, not even for its owner.
      if (isUpgrade(request) || !isSafe(request.method)) return appError(404, "No such app.");
      const ticket = this.#o.tokens.ticket({ userId: user.id, agentId: p.agentId, port: p.port });
      const to = `${p.rest}${url.search}`;
      const q = new URLSearchParams({ t: ticket, to });
      return redirect(`${appOrigin(d, label)}${APP_AUTH_PATH}?${q}`);
    }
    return this.#forward(request, url, server, svc, decision.access, prefix);
  }

  async #appHost(
    request: Request,
    url: URL,
    server: Server<unknown>,
    d: AppDomain,
    app: { agentId: string; port: number; label: string },
  ) {
    const origin = appOrigin(d, app.label);
    if (url.pathname === APP_AUTH_PATH) {
      const grant = this.#o.tokens.redeemTicket(
        url.searchParams.get("t") ?? "",
        app.agentId,
        app.port,
      );
      if (!grant)
        return appError(403, "This link has expired; open the app from the office again.");
      const value = this.#o.tokens.cookie(grant);
      return redirect(safeReturnPath(url.searchParams.get("to")), {
        "set-cookie": appCookieHeader(d.protocol, value),
      });
    }
    if (isUpgrade(request) || !isSafe(request.method)) {
      const got = request.headers.get("origin");
      if ((isUpgrade(request) || got !== null) && got !== origin) {
        return appError(403, "Cross-origin request refused.");
      }
    }
    const svc = this.#service(app.agentId, app.port);
    const token = readCookie(request.headers.get("cookie"), appCookieName(d.protocol));
    const grant = token ? this.#o.tokens.verifyCookie(token, app.agentId, app.port) : null;
    const user = grant ? this.#o.userById(grant.userId) : null;
    if (!user) {
      // Through the office, which checks the session and comes back with a ticket.
      if (svc && request.method === "GET" && !isUpgrade(request)) {
        const back = `${servicesProxyPath(svc.floorId, app.agentId, app.port)}${url.pathname.slice(1)}${url.search}`;
        return redirect(new URL(back, this.#o.originPolicy.publicUrl).toString());
      }
      return appError(401, "Open this app from the office.");
    }
    if (!svc) return appError(404, "No such app.");
    const decision = decideAppAccess(user, svc, this.#o.canViewFloor, true);
    if (!decision.ok) return this.#denied(decision.reason, user, svc);
    return this.#unreachable(svc) ?? this.#forward(request, url, server, svc, decision.access, "");
  }

  async #forward(
    request: Request,
    url: URL,
    server: Server<unknown>,
    svc: ProxyableService,
    access: AppAccess,
    prefix: string,
  ): Promise<Response | typeof UPGRADED> {
    const target = svc.target;
    if (!target) return appError(502, "The app is not reachable.");
    if (!methodAllowed(access, request.method)) {
      return appError(405, "Read-only: only the robot's owner can use this app beyond viewing it.");
    }
    const ctx: ForwardContext = {
      target,
      port: svc.port,
      prefix,
      publicHost: url.host,
      publicProto: url.protocol.replace(/:$/, ""),
      clientIp: server.requestIP(request)?.address,
    };
    if (!isUpgrade(request)) return forwardHttp(request, url, ctx);
    const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let data: Awaited<ReturnType<typeof openUpstream>>;
    try {
      const wsUrl = upstreamUrl(target, svc.port, `${url.pathname}${url.search}`, true);
      data = await openUpstream(
        wsUrl,
        requestHeaders(request.headers, ctx, true),
        protocols,
        access,
      );
    } catch {
      return appError(502, "The app's WebSocket is not reachable.");
    }
    const chosen = data.upstream.protocol;
    const headers = chosen ? { "sec-websocket-protocol": chosen } : undefined;
    if (!server.upgrade(request, { data, headers })) {
      data.upstream.close();
      return appError(400, "WebSocket upgrade failed.");
    }
    return UPGRADED;
  }

  #service(agentId: string, port: number): ProxyableService | undefined {
    const svc = this.#o.registry.find(agentId, port);
    if (!svc) return undefined;
    // Defence in depth: the office's own port on loopback is never a target.
    const t = svc.target;
    if (t && isLoopback(t.host) && port === this.#o.officePort) return undefined;
    return svc;
  }

  #unreachable(svc: ProxyableService): Response | undefined {
    if (svc.localOnly) {
      return appError(
        502,
        `The app listens on localhost only inside the robot's sandbox, so the office cannot reach it.\nRestart it bound to 0.0.0.0 (Vite: --host, Next.js: -H 0.0.0.0, most others: --host 0.0.0.0).`,
      );
    }
    return svc.target ? undefined : appError(502, "The app is not reachable from the office.");
  }

  #denied(reason: "not_found" | "owner_only", user: AppUser, svc: ProxyableService): Response {
    this.#o.logger.info({ agentId: svc.agentId, userId: user.id, reason }, "app access denied");
    return reason === "owner_only"
      ? appError(
          403,
          "Only the robot's owner can open this app. Sharing app previews needs OFFICE_SERVICES_DOMAIN.",
        )
      : appError(404, "No such app.");
  }
}

function redirect(location: string, extra: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 302,
    headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer", ...extra },
  });
}

export function readCookie(header: string | null, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
