/**
 * REST for a `hermes-external` agent's connection (#58). Shapes are in
 * `@regulus/protocol` office-agent-hermes.ts; the rules are service.ts here.
 *
 *   POST /api/office-agents/hermes/test    try an address and token, or an agent's stored connection
 *   PUT  /api/office-agents/:id/hermes     replace the agent's connection (its owner only)
 *
 * Session cookie and a same-origin request on both. No response carries the
 * address or the token, and neither is cached.
 */
import {
  HermesConnectionInput,
  HermesConnectionTest,
  OFFICE_AGENT_HERMES_TEST_API_PATH,
  OFFICE_AGENTS_API_PATH,
} from "@regulus/protocol";
import type { OfficeAuth } from "../../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../../auth/errors.ts";
import { checkOrigin } from "../../auth/origin.ts";
import { readJsonBody } from "../../http/body.ts";
import { json, type RouteContext, type Router } from "../../http/router.ts";
import type { OperationActor } from "../../operations/access.ts";
import type { HermesAgentService } from "./service.ts";

export interface HermesRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  hermes: HermesAgentService;
}

const NO_STORE = { headers: { "cache-control": "no-store" } };

/** Mount before the `/:id` routes of routes.ts: `hermes/test` is a fixed path. */
export function mountHermesRoutes(router: Router, deps: HermesRoutesDeps): void {
  const { auth, hermes } = deps;
  const handle =
    (fn: (ctx: RouteContext, actor: OperationActor) => Promise<Response>) =>
    async (ctx: RouteContext) => {
      try {
        const check = checkOrigin(ctx.request, auth.publicUrl, {
          allowedOrigins: auth.allowedOrigins,
        });
        if (!check.ok) throw forbidden("origin_mismatch");
        const user = await auth.getSessionFromRequest(ctx.request);
        if (!user) throw unauthorized();
        return await fn(ctx, { id: user.id, role: user.role });
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        throw err;
      }
    };

  router.post(
    OFFICE_AGENT_HERMES_TEST_API_PATH,
    handle(async (ctx, actor) => {
      const input = await readJsonBody(ctx.request, HermesConnectionTest);
      return json(await hermes.test(actor, input), NO_STORE);
    }),
  );
  router.add(
    "PUT",
    `${OFFICE_AGENTS_API_PATH}/:id/hermes`,
    handle(async (ctx, actor) => {
      const input = await readJsonBody(ctx.request, HermesConnectionInput);
      return json(await hermes.setConnection(actor, ctx.params.id ?? "", input), NO_STORE);
    }),
  );
}
