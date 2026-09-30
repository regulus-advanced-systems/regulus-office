/**
 * Conditional GETs for board polling (#35), following GitHub's guidance:
 *
 * - send the last `ETag` as `If-None-Match`; a `304 Not Modified` answered to
 *   an authorized request does not count against the primary rate limit.
 *   https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate
 * - read `x-ratelimit-remaining` / `x-ratelimit-reset`; on `429`, or `403`
 *   with `retry-after`, zero remaining or a secondary-limit message, stop until
 *   `retry-after` / the reset time, else back off at least a minute.
 *   https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit
 *
 * The token only travels in `Authorization`; error text is redacted.
 */
import { type FetchFn, redactGitHubText } from "./api.ts";
import { GITHUB_API_VERSION, GitHubApiError } from "./pulls.ts";

const REQUEST_TIMEOUT_MS = 20_000;
/** Pause proactively when fewer requests than this are left in the window. */
export const RATE_LIMIT_FLOOR = 50;
/** Wait after a secondary rate limit without `retry-after` (GitHub: "at least one minute"). */
export const SECONDARY_BACKOFF_MS = 60_000;

export class RateLimitedError extends Error {
  override name = "RateLimitedError";
  constructor(readonly until: number) {
    super("GitHub rate limit");
  }
}

export type Conditional<T> =
  | { status: 200; body: T; etag: string | null }
  | { status: 304; etag: string | null };

export interface PollClient {
  get<T>(path: string, token: string, etag?: string | null): Promise<Conditional<T>>;
  /** Earliest time the next request may go out (rate limit), or 0. */
  readonly pausedUntil: number;
}

export function createPollClient(deps: {
  apiBase: string;
  fetch?: FetchFn;
  now?: () => number;
}): PollClient {
  const base = deps.apiBase.replace(/\/+$/, "");
  const doFetch: FetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? Date.now;
  let pausedUntil = 0;

  const resetAt = (res: Response): number | null => {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    return Number.isFinite(reset) && reset > 0 ? reset * 1000 : null;
  };

  return {
    get pausedUntil() {
      return pausedUntil;
    },
    async get<T>(path: string, token: string, etag?: string | null): Promise<Conditional<T>> {
      if (pausedUntil > now()) throw new RateLimitedError(pausedUntil);
      let res: Response;
      try {
        res = await doFetch(`${base}${path}`, {
          method: "GET",
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token}`,
            "x-github-api-version": GITHUB_API_VERSION,
            "user-agent": "regulus-office",
            ...(etag ? { "if-none-match": etag } : {}),
          },
          redirect: "error",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new GitHubApiError(0, redactGitHubText(`cannot reach GitHub: ${reason}`, [token]));
      }
      const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? Number.NaN);
      const retryAfter = Number(res.headers.get("retry-after") ?? Number.NaN);
      if (res.status === 429 || res.status === 403) {
        let message = "";
        try {
          const body = (await res.json()) as { message?: unknown };
          message = typeof body.message === "string" ? body.message : "";
        } catch {
          message = "";
        }
        const limited =
          res.status === 429 ||
          Number.isFinite(retryAfter) ||
          remaining === 0 ||
          /rate limit/i.test(message);
        if (limited) {
          const until = Number.isFinite(retryAfter)
            ? now() + retryAfter * 1000
            : remaining === 0
              ? (resetAt(res) ?? now() + SECONDARY_BACKOFF_MS)
              : now() + SECONDARY_BACKOFF_MS;
          pausedUntil = Math.max(pausedUntil, until);
          throw new RateLimitedError(pausedUntil);
        }
        throw new GitHubApiError(
          403,
          redactGitHubText(message || "Forbidden", [token]).slice(0, 300),
        );
      }
      if (Number.isFinite(remaining) && remaining < RATE_LIMIT_FLOOR) {
        const reset = resetAt(res);
        if (reset && reset > now()) pausedUntil = Math.max(pausedUntil, reset);
      }
      const newEtag = res.headers.get("etag");
      if (res.status === 304) return { status: 304, etag: newEtag ?? etag ?? null };
      if (!res.ok) {
        let message = res.statusText;
        try {
          const body = (await res.json()) as { message?: unknown };
          if (typeof body.message === "string") message = body.message;
        } catch {
          // keep the status text
        }
        throw new GitHubApiError(
          res.status,
          redactGitHubText(message || "error", [token]).slice(0, 300),
        );
      }
      return { status: 200, body: (await res.json()) as T, etag: newEtag };
    },
  };
}
