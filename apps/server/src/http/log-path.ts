/**
 * Paths that are safe to write to logs (issue #90, SPEC §8/§11).
 *
 * Invite links carry a bearer token in the path (`/join/<token>`,
 * `/api/invites/<token>`, `/api/join/<token>`) and OAuth callbacks carry
 * `code`/`state` in the query string, so request logs never record the raw
 * URL. Routed requests log their router pattern (the same bounded label the
 * metrics use); everything else logs a redacted pathname. Query strings are
 * never logged.
 */

export const REDACTED_SEGMENT = "[redacted]";

/** A segment named like this is followed by a secret (invite token). */
const SECRET_PARENT_SEGMENTS = new Set(["join", "invites"]);

/** Longest path we log; anything past it is cut so hostile URLs cannot flood the log. */
const MAX_LOGGED_PATH = 200;

/**
 * Redacts every path segment that follows a `join` or `invites` segment
 * (matched case-insensitively), e.g. `/join/abc` -> `/join/[redacted]`.
 * Accepts a pathname or a full path with query/fragment; those are dropped.
 */
export function redactPath(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  const segments = pathname.split("/");
  let redactNext = false;
  const out = segments.map((segment) => {
    if (segment === "") return segment;
    // Everything after a secret-parent segment is redacted, not just the next one.
    if (redactNext) return REDACTED_SEGMENT;
    redactNext = SECRET_PARENT_SEGMENTS.has(safeDecode(segment).toLowerCase());
    return segment;
  });
  const joined = out.join("/");
  return joined.length > MAX_LOGGED_PATH ? `${joined.slice(0, MAX_LOGGED_PATH)}...` : joined;
}

/**
 * The path to put in a log line. `route` is the router pattern when the
 * request matched one (patterns start with "/"); other labels ("static",
 * "rooms", "ws", "405", "error") fall back to the redacted pathname.
 */
export function safeLogPath(url: URL | string, route?: string): string {
  if (route?.startsWith("/")) return route;
  const pathname = typeof url === "string" ? url : url.pathname;
  return redactPath(pathname);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Absolute URLs or root-relative paths inside free text. */
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`]+|(?<![\w/:.])\/[^\s"'<>`]+/gi;
const RELATIVE_BASE = "http://relative.invalid";

/**
 * Makes third-party log text (Better Auth, Colyseus) safe: every URL in it
 * loses its query string and fragment and has invite segments redacted.
 * Better Auth logs rejected redirect/callback URLs verbatim, and those can
 * carry OAuth `code`/`state` or an invite link.
 */
export function redactUrlsInText(text: string): string {
  return text.replace(URL_IN_TEXT, (match) => {
    try {
      const url = new URL(match, RELATIVE_BASE);
      const origin = url.origin === RELATIVE_BASE ? "" : `${url.protocol}//${url.host}`;
      const tail = url.search || url.hash ? "?[redacted]" : "";
      return `${origin}${redactPath(url.pathname)}${tail}`;
    } catch {
      return "[redacted-url]";
    }
  });
}
