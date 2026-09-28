/**
 * Origin check for WebSocket upgrades and matchmaking requests (SPEC §11:
 * "Origin checked on WS"). Browsers always send `Origin` on both; a request
 * without one comes from a non-browser client and is left to authentication.
 *
 * TODO(#11): may be replaced by `checkOrigin(request, publicUrl)` from
 * apps/server/src/auth once both land on master.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Origins allowed to open rooms: the public URL, plus local dev servers outside production. */
export function allowedOriginsFor(publicUrl: string, production: boolean): readonly string[] {
  const origins = new Set<string>();
  try {
    origins.add(new URL(publicUrl).origin);
  } catch {
    // an unparsable public URL allows nothing but local development below
  }
  if (!production) {
    for (const host of LOCAL_HOSTS) origins.add(`http://${host}`);
  }
  return [...origins];
}

/**
 * True when `origin` (the raw header value, or null when absent) may connect.
 * Local development entries match any port on that host.
 */
export function isOriginAllowed(origin: string | null, allowed: readonly string[]): boolean {
  if (origin === null || origin === "") return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin === "null") return false;
  for (const entry of allowed) {
    if (entry === parsed.origin) return true;
    if (entry.startsWith("http://") && LOCAL_HOSTS.has(entry.slice("http://".length))) {
      if (parsed.protocol === "http:" && parsed.hostname === entry.slice("http://".length))
        return true;
    }
  }
  return false;
}
