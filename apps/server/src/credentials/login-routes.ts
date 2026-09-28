/**
 * REST for CLI subscription logins (SPEC §7 login column, §8 rule 1):
 *
 *   GET  /api/provider-logins                        connected? per CLI provider (the CLI's own status)
 *   POST /api/provider-logins/:provider              start a login (claude-code | codex)
 *   GET  /api/provider-logins/flows/:loginId         poll a login (own flows only)
 *   POST /api/provider-logins/flows/:loginId/cancel  cancel it
 *
 * Responses carry the device code / terminal id the CLI hands out for the
 * human to act on; never a token (the office never has one).
 */
import { isCliLoginProvider, PROVIDER_LOGINS_API_PATH } from "@regulus/protocol";
import { AuthHttpError } from "../auth/errors.ts";
import { type RateLimitRule, TokenBucketLimiter } from "../auth/rate-limit.ts";
import type { Router } from "../http/router.ts";
import { type CredentialAuth, noStore, routeFactory } from "./http.ts";
import type { LoginFlows } from "./login-flows.ts";

/** Each start runs a CLI in the runner: 5 at once, then 1 a minute. */
export const DEFAULT_LOGIN_START_LIMIT: RateLimitRule = { capacity: 5, refillPerSecond: 1 / 60 };

export interface LoginRoutesDeps {
  auth: CredentialAuth;
  flows: LoginFlows;
  startLimit?: RateLimitRule;
  now?: () => number;
}

export function mountLoginRoutes(router: Router, deps: LoginRoutesDeps): void {
  const { flows } = deps;
  const route = routeFactory({ auth: deps.auth });
  const limiter = new TokenBucketLimiter(deps.startLimit ?? DEFAULT_LOGIN_START_LIMIT, deps.now);
  const base = PROVIDER_LOGINS_API_PATH;

  router.get(
    base,
    route(async (_ctx, actor) => noStore({ providers: await flows.status(actor) })),
  );

  router.post(
    `${base}/:provider`,
    route(
      async (ctx, actor) => {
        const provider = ctx.params.provider ?? "";
        if (!isCliLoginProvider(provider)) throw new AuthHttpError(400, "invalid_provider");
        return noStore(await flows.start(actor, provider), 201);
      },
      { write: true, limiter },
    ),
  );

  router.get(
    `${base}/flows/:loginId`,
    route(async (ctx, actor) => noStore(await flows.get(actor, ctx.params.loginId ?? ""))),
  );

  router.post(
    `${base}/flows/:loginId/cancel`,
    route(
      async (ctx, actor) => {
        await flows.cancel(actor, ctx.params.loginId ?? "");
        return new Response(null, { status: 204 });
      },
      { write: true },
    ),
  );
}
