/**
 * Origin check for cookie-authenticated requests and room connections (SPEC
 * §11 "Origin checked on WS"). Browsers always send `Origin` on WebSocket
 * upgrades, matchmaking and cross-site POSTs, so a mismatch means a cross-site
 * page is driving the request. One implementation serves the HTTP routes in
 * ./routes.ts and the Colyseus transport in ../rooms.
 */

export interface OriginCheckOptions {
  /** Extra origins to accept besides the public URL (e.g. a Vite dev server). */
  allowedOrigins?: readonly string[];
  /** Accept `http://localhost`, `http://127.0.0.1` and `http://[::1]` on any port (development). */
  allowLocalDev?: boolean;
  /** Reject requests with no `Origin` header (default: allow; non-browser clients omit it). */
  requireOrigin?: boolean;
}

/** {@link OriginCheckOptions} together with the public URL they apply to. */
export interface OriginPolicy extends OriginCheckOptions {
  publicUrl: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The office's policy: the public origin, plus local dev servers outside production. */
export function originPolicyFor(publicUrl: string, production: boolean): OriginPolicy {
  return { publicUrl, allowLocalDev: !production };
}

export type OriginCheck =
  | { ok: true; origin: string | null }
  | { ok: false; reason: "missing" | "malformed" | "mismatch"; origin: string | null };

function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.origin === "null" ? undefined : parsed.origin;
  } catch {
    return undefined;
  }
}

/** Compare the request's `Origin` against `publicUrl` (scheme + host + port only). */
export function checkOrigin(
  request: Request,
  publicUrl: string,
  options: OriginCheckOptions = {},
): OriginCheck {
  const origin = request.headers.get("origin");
  if (origin === null) {
    return options.requireOrigin ? { ok: false, reason: "missing", origin } : { ok: true, origin };
  }
  const actual = originOf(origin);
  if (!actual) return { ok: false, reason: "malformed", origin };
  if (options.allowLocalDev) {
    const parsed = new URL(actual);
    if (parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname))
      return { ok: true, origin };
  }
  const allowed = new Set<string>();
  for (const candidate of [publicUrl, ...(options.allowedOrigins ?? [])]) {
    const o = originOf(candidate);
    if (o) allowed.add(o);
  }
  return allowed.has(actual) ? { ok: true, origin } : { ok: false, reason: "mismatch", origin };
}
