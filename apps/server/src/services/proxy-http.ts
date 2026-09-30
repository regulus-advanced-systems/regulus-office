/**
 * HTTP forwarding for the services proxy (#39): builds the upstream request to
 * a robot's dev server and cleans both directions.
 *
 * To the app: no office credentials. Office cookies (`office.*`, and their
 * `__Secure-`/`__Host-` forms, which include the app cookie) and `x-office-*`
 * headers are removed; client `forwarded`/`x-forwarded-*` are replaced by the
 * office's own; hop-by-hop headers are dropped. `Host` is `localhost:<port>`,
 * which dev servers' host checks (Vite, webpack) always accept; the public
 * host is in `X-Forwarded-Host`.
 *
 * From the app: no way to reach the office's cookies or origin-wide state.
 * `Set-Cookie` for office cookie names is dropped, `Domain` is removed (so a
 * cookie can never be scoped to the office or its sibling apps), and in path
 * mode `Path` is pinned under the app's prefix. `Clear-Site-Data` and
 * `Service-Worker-Allowed` are dropped; redirects to the upstream's own
 * address are made relative, and in path mode root-relative ones get the prefix.
 *
 * The path is forwarded unchanged, prefix included: an app behind
 * `/p/<floor>/a/<agent>/port/<n>/` must be configured with that base (Vite
 * `base`, Next `basePath`); app domain mode serves it at `/`.
 */
import type { ServiceTarget } from "./discovery.ts";

export interface ForwardContext {
  target: ServiceTarget;
  port: number;
  /** Path mode: `/p/<floor>/a/<agent>/port/<n>/`; app domain mode: "". */
  prefix: string;
  /** Host and protocol the browser used (`office.example`, `https`). */
  publicHost: string;
  publicProto: string;
  /** The browser's address, when known. */
  clientIp?: string;
  /** Upstream timeout for the response headers. */
  timeoutMs?: number;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "forwarded",
  "x-real-ip",
]);

const WS_HANDSHAKE = new Set([
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
  "sec-websocket-accept",
]);

/** Office cookie names: Better Auth's `office.*` (and `__Secure-`/`__Host-` forms), the app cookie. */
export function isOfficeCookie(name: string): boolean {
  return /^(?:__(?:Secure|Host)-)?office\./i.test(name.trim());
}

/** `Cookie` without the office's cookies; null when nothing is left. */
export function stripOfficeCookies(header: string | null): string | null {
  if (!header) return null;
  const kept = header
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c && !isOfficeCookie(c.split("=")[0] ?? ""));
  return kept.length > 0 ? kept.join("; ") : null;
}

/** The upstream URL: host and port from the registry, the path as the browser sent it. */
export function upstreamUrl(
  target: ServiceTarget,
  port: number,
  pathAndQuery: string,
  ws = false,
): string {
  if (!pathAndQuery.startsWith("/")) throw new Error("path must be absolute");
  const host = target.host.includes(":") ? `[${target.host}]` : target.host;
  // String concatenation, never `new URL(path, base)`: `//evil.example/` must stay a path.
  const url = `${ws ? "ws" : "http"}://${host}:${port}${pathAndQuery}`;
  const parsed = new URL(url);
  if (parsed.hostname.replace(/^\[|\]$/g, "") !== target.host || Number(parsed.port) !== port) {
    throw new Error("upstream URL escaped its target");
  }
  return url;
}

export function requestHeaders(incoming: Headers, ctx: ForwardContext, ws = false): Headers {
  const out = new Headers();
  for (const [name, value] of incoming) {
    const n = name.toLowerCase();
    if (HOP_BY_HOP.has(n) || n.startsWith("x-forwarded-") || n.startsWith("x-office-")) continue;
    if (ws && (WS_HANDSHAKE.has(n) || n === "sec-websocket-protocol")) continue;
    if (n === "cookie") continue;
    out.append(name, value);
  }
  const cookie = stripOfficeCookies(incoming.get("cookie"));
  if (cookie) out.set("cookie", cookie);
  out.set("host", `localhost:${ctx.port}`);
  out.set("x-forwarded-host", ctx.publicHost);
  out.set("x-forwarded-proto", ctx.publicProto);
  if (ctx.clientIp) out.set("x-forwarded-for", ctx.clientIp);
  if (ctx.prefix) out.set("x-forwarded-prefix", ctx.prefix.replace(/\/$/, ""));
  return out;
}

/** One `Set-Cookie` made safe, or null to drop it. */
export function rewriteSetCookie(cookie: string, prefix: string): string | null {
  const [pair = "", ...rest] = cookie.split(";");
  const name = pair.split("=")[0]?.trim() ?? "";
  if (!name || isOfficeCookie(name)) return null;
  // `__Host-` requires Path=/, which path mode cannot allow.
  if (prefix && /^__Host-/i.test(name)) return null;
  const attrs = rest.map((a) => a.trim()).filter(Boolean);
  const given =
    attrs
      .find((a) => /^path\s*=/i.test(a))
      ?.split("=")[1]
      ?.trim() || "/";
  const base = prefix.replace(/\/$/, "");
  const path = !prefix || given === base || given.startsWith(`${base}/`) ? given : base;
  const kept = attrs.filter((a) => !/^(domain|path)\s*(=|$)/i.test(a));
  return [pair.trim(), `Path=${path}`, ...kept].join("; ");
}

/** Where a redirect goes, kept on the proxy: upstream-absolute URLs become paths. */
export function rewriteLocation(location: string, ctx: ForwardContext): string {
  let loc = location;
  try {
    const u = new URL(loc);
    const local = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "[::]", ctx.target.host]);
    if (local.has(u.hostname) && Number(u.port || 80) === ctx.port)
      loc = `${u.pathname}${u.search}${u.hash}`;
  } catch {
    // relative
  }
  if (ctx.prefix && loc.startsWith("/") && !loc.startsWith("//") && !loc.startsWith(ctx.prefix)) {
    const base = ctx.prefix.replace(/\/$/, "");
    if (loc !== base) loc = `${base}${loc}`;
  }
  return loc;
}

const DROP_RESPONSE = new Set([...HOP_BY_HOP, "clear-site-data", "service-worker-allowed"]);

export function responseHeaders(incoming: Headers, ctx: ForwardContext): Headers {
  const out = new Headers();
  for (const [name, value] of incoming) {
    const n = name.toLowerCase();
    if (DROP_RESPONSE.has(n) || n === "set-cookie") continue;
    out.append(name, n === "location" ? rewriteLocation(value, ctx) : value);
  }
  for (const c of incoming.getSetCookie()) {
    const safe = rewriteSetCookie(c, ctx.prefix);
    if (safe) out.append("set-cookie", safe);
  }
  return out;
}

/** Forward one HTTP request and stream the answer back. */
export async function forwardHttp(
  request: Request,
  url: URL,
  ctx: ForwardContext,
): Promise<Response> {
  const target = upstreamUrl(ctx.target, ctx.port, `${url.pathname}${url.search}`);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  // The timeout covers the response headers only; the body may stream for long (SSE).
  const headersDue = new AbortController();
  const timer = setTimeout(() => headersDue.abort(), ctx.timeoutMs ?? 30_000);
  const signal = AbortSignal.any([request.signal, headersDue.signal]);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: requestHeaders(request.headers, ctx),
      body: hasBody ? request.body : undefined,
      redirect: "manual",
      decompress: false,
      signal,
      // Streams the request body through.
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch {
    const timedOut = headersDue.signal.aborted;
    return appError(
      timedOut ? 504 : 502,
      timedOut ? "The app did not answer in time." : "The app is not reachable.",
    );
  } finally {
    clearTimeout(timer);
  }
  if (request.method === "HEAD") await upstream.body?.cancel();
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders(upstream.headers, ctx),
  });
}

/** A small plain-text error page (never the upstream's address). */
export function appError(status: number, message: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
