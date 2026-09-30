/**
 * REST for the usage tracker (#40).
 *
 *   GET /api/usage/me?tz=<getTimezoneOffset()>   the signed-in viewer's own limits and spend
 *
 * Read-only; the viewer id comes from the session only, so nobody can ask
 * for another human's limits or spend (summary.ts). Office totals are
 * BuildingRoom state.
 */
import { MY_USAGE_API_PATH } from "@regulus/protocol";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, unauthorized } from "../auth/errors.ts";
import { json, type Router } from "../http/router.ts";
import type { UsageSummaries } from "./summary.ts";

export interface UsageRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest">;
  summaries: Pick<UsageSummaries, "mine">;
}

export function mountUsageRoutes(router: Router, deps: UsageRoutesDeps): void {
  router.get(MY_USAGE_API_PATH, async (ctx) => {
    try {
      const user = await deps.auth.getSessionFromRequest(ctx.request);
      if (!user) throw unauthorized();
      const tz = Number(ctx.url.searchParams.get("tz") ?? "0");
      return json(deps.summaries.mine(user.id, Number.isFinite(tz) ? Math.trunc(tz) : 0), {
        headers: { "cache-control": "no-store" },
      });
    } catch (err) {
      if (err instanceof AuthHttpError) return err.toResponse();
      throw err;
    }
  });
}
