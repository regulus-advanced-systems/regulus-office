/**
 * Origin check for cookie-authenticated requests (SPEC §11 "Origin checked on
 * WS"). Browsers always send `Origin` on WebSocket upgrades and cross-site
 * POSTs, so a mismatch means a cross-site page is driving the request.
 */

export interface OriginCheckOptions {
  /** Extra origins to accept besides the public URL (e.g. a Vite dev server). */
  allowedOrigins?: readonly string[];
  /** Reject requests with no `Origin` header (default: allow; non-browser clients omit it). */
  requireOrigin?: boolean;
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
  const allowed = new Set<string>();
  for (const candidate of [publicUrl, ...(options.allowedOrigins ?? [])]) {
    const o = originOf(candidate);
    if (o) allowed.add(o);
  }
  return allowed.has(actual) ? { ok: true, origin } : { ok: false, reason: "mismatch", origin };
}
