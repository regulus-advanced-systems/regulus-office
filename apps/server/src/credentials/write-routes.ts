/**
 * REST for key profiles (SPEC §8 rules 2 and 3, D2). Session-cookie auth;
 * writes need a same-origin request; calls that verify a key against a
 * provider are rate limited per user.
 *
 *   GET    /api/credential-profiles/manage        own key profiles + office keys (panel)
 *   POST   /api/credential-profiles               create (verify, encrypt, store)
 *   POST   /api/credential-profiles/:id/verify    re-enter the key, verify, replace
 *   DELETE /api/credential-profiles/:id           delete (own; office keys: owner/admin)
 *
 * The spawn dialog's read-only list (`GET /api/credential-profiles`) is list.ts.
 * Keys are accepted in bodies and never returned.
 */
import {
  CREDENTIAL_PROFILE_WRITE_PATH,
  CreateKeyProfileRequest,
  VerifyKeyProfileRequest,
} from "@regulus/protocol";
import { type RateLimitRule, TokenBucketLimiter } from "../auth/rate-limit.ts";
import type { Router } from "../http/router.ts";
import { type CredentialAuth, noStore, readBody, routeFactory } from "./http.ts";
import type { KeyProfileService } from "./profiles.ts";

/** Each create/verify makes one outbound call with the key: 5 at once, then 1 every 12 s. */
export const DEFAULT_VERIFY_LIMIT: RateLimitRule = { capacity: 5, refillPerSecond: 5 / 60 };

export interface KeyProfileRoutesDeps {
  auth: CredentialAuth;
  profiles: KeyProfileService;
  verifyLimit?: RateLimitRule;
  now?: () => number;
}

export function mountKeyProfileRoutes(
  router: Router,
  deps: KeyProfileRoutesDeps,
): {
  limiter: TokenBucketLimiter;
} {
  const { profiles } = deps;
  const route = routeFactory({ auth: deps.auth });
  const limiter = new TokenBucketLimiter(deps.verifyLimit ?? DEFAULT_VERIFY_LIMIT, deps.now);
  const base = CREDENTIAL_PROFILE_WRITE_PATH;

  router.get(
    `${base}/manage`,
    route((_ctx, actor) => noStore({ profiles: profiles.list(actor) })),
  );

  router.post(
    base,
    route(
      async (ctx, actor) => {
        const body = await readBody(ctx.request, CreateKeyProfileRequest);
        return noStore(await profiles.create(actor, body), 201);
      },
      { write: true, limiter },
    ),
  );

  router.post(
    `${base}/:profileId/verify`,
    route(
      async (ctx, actor) => {
        const body = await readBody(ctx.request, VerifyKeyProfileRequest);
        return noStore(await profiles.reverify(actor, ctx.params.profileId ?? "", body.apiKey));
      },
      { write: true, limiter },
    ),
  );

  router.add(
    "DELETE",
    `${base}/:profileId`,
    route(
      (ctx, actor) => {
        profiles.delete(actor, ctx.params.profileId ?? "");
        return new Response(null, { status: 204 });
      },
      { write: true },
    ),
  );

  return { limiter };
}
