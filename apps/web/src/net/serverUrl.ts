/**
 * Resolve the office-server base URL. `VITE_OFFICE_URL` wins when set;
 * otherwise the page origin is used (production: the server serves the
 * built client itself, SPEC §4.1).
 */
export function resolveServerUrl(envValue: string | undefined, origin: string): string {
  const raw = envValue?.trim();
  const base = raw && raw.length > 0 ? raw : origin;
  return base.replace(/\/+$/, "");
}

/** Convert an http(s) base URL to its ws(s) twin; ws(s) URLs pass through. */
export function toWebSocketUrl(base: string): string {
  return base.replace(/^http(s?):/i, "ws$1:");
}

export function officeServerUrl(): string {
  const origin = typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;
  return resolveServerUrl(import.meta.env.VITE_OFFICE_URL, origin);
}
