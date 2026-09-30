/**
 * REST for search (#41); shapes and paths in `@regulus/protocol` search-api.ts.
 *
 *   GET /api/search?q=...                 grouped hits the viewer may see
 *   GET /api/search/context?doc=N&q=...   scrollback lines around a hit
 *
 * Session required. Both routes share one token bucket per user (a burst of
 * 20, then 4 per second), which is plenty for search-as-you-type and stops a
 * client from hammering the index. The raw query is never logged.
 */
import { SEARCH_API_PATH, SEARCH_CONTEXT_API_PATH, type SearchError } from "@regulus/protocol";
import type { OfficeAuth, SessionUser } from "../auth/auth.ts";
import { type RateLimitRule, TokenBucketLimiter } from "../auth/rate-limit.ts";
import { json, type RouteContext, type Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import { parseSearchQuery } from "./query.ts";
import type { Searcher } from "./searcher.ts";

export const SEARCH_RATE_LIMIT: RateLimitRule = { capacity: 20, refillPerSecond: 4 };

export interface SearchRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest">;
  searcher: Searcher;
  /** Brings the chat index up to date before a query (cheap: one indexed range read). */
  beforeQuery?: () => void;
  logger: Logger;
  limiter?: TokenBucketLimiter;
}

const NO_STORE = { "cache-control": "no-store" };

function fail(status: number, error: SearchError["error"], extra: HeadersInit = {}): Response {
  return json({ error } satisfies SearchError, { status, headers: { ...NO_STORE, ...extra } });
}

type Handler = (ctx: RouteContext, user: SessionUser) => Response;

export function mountSearchRoutes(router: Router, deps: SearchRoutesDeps): TokenBucketLimiter {
  const limiter = deps.limiter ?? new TokenBucketLimiter(SEARCH_RATE_LIMIT);
  const guarded =
    (handler: Handler) =>
    async (ctx: RouteContext): Promise<Response> => {
      const user = await deps.auth.getSessionFromRequest(ctx.request);
      if (!user) return fail(401, "unauthorized");
      const decision = limiter.take(user.id);
      if (!decision.ok) {
        return fail(429, "rate_limited", { "retry-after": String(decision.retryAfterSeconds) });
      }
      try {
        return handler(ctx, user);
      } catch (err) {
        // An FTS5 error here would mean the sanitiser let syntax through; never echo it.
        deps.logger.error({ err: String(err) }, "search failed");
        return fail(400, "bad_query");
      }
    };

  router.get(
    SEARCH_API_PATH,
    guarded((ctx, user) => {
      const parsed = parseSearchQuery(ctx.url.searchParams.get("q") ?? "");
      if (!parsed) return json({ terms: [], groups: [], truncated: false }, { headers: NO_STORE });
      deps.beforeQuery?.();
      return json(deps.searcher.search(user, parsed), { headers: NO_STORE });
    }),
  );

  router.get(
    SEARCH_CONTEXT_API_PATH,
    guarded((ctx, user) => {
      const doc = Number(ctx.url.searchParams.get("doc"));
      if (!Number.isSafeInteger(doc) || doc <= 0) return fail(400, "bad_query");
      const terms = parseSearchQuery(ctx.url.searchParams.get("q") ?? "")?.terms ?? [];
      const context = deps.searcher.context(user, doc, terms);
      return context ? json(context, { headers: NO_STORE }) : fail(404, "not_found");
    }),
  );
  return limiter;
}
