/**
 * REST for office agents in the world (#252); rules in service.ts.
 *
 *   GET  /api/office-agents/attention      what the caller's agents want from them
 *   POST /api/office-agents/:id/dismiss    a personal agent's owner sends it off to wander
 *   POST /api/office-agents/:id/recall     and calls it back
 *   POST /api/office-agents/:id/seen       the caller has read their conversation with it
 *
 * Session cookie on everything; writes need a same-origin request.
 */
import { OFFICE_AGENT_ATTENTION_API_PATH, OFFICE_AGENTS_API_PATH } from "@regulus/protocol";
import type { OfficeAuth } from "../../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../../auth/errors.ts";
import { checkOrigin } from "../../auth/origin.ts";
import { json, type RouteContext, type Router } from "../../http/router.ts";
import type { OperationActor } from "../../operations/access.ts";
import type { AgentWorldService } from "./service.ts";

export interface AgentWorldRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  service: AgentWorldService;
}

const AGENT = `${OFFICE_AGENTS_API_PATH}/:id`;

/** Mount before the office agent routes: `/attention` must not be read as an agent id. */
export function mountAgentWorldRoutes(router: Router, deps: AgentWorldRoutesDeps): void {
  const { auth, service } = deps;
  const handle =
    (fn: (ctx: RouteContext, actor: OperationActor) => Response, write = false) =>
    async (ctx: RouteContext) => {
      try {
        if (write) {
          const check = checkOrigin(ctx.request, auth.publicUrl, {
            allowedOrigins: auth.allowedOrigins,
          });
          if (!check.ok) throw forbidden("origin_mismatch");
        }
        const user = await auth.getSessionFromRequest(ctx.request);
        if (!user) throw unauthorized();
        return fn(ctx, { id: user.id, role: user.role });
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        throw err;
      }
    };
  const id = (ctx: RouteContext) => ctx.params.id ?? "";

  router.get(
    OFFICE_AGENT_ATTENTION_API_PATH,
    handle((_ctx, actor) =>
      json(service.attention(actor), { headers: { "cache-control": "no-store" } }),
    ),
  );
  router.post(
    `${AGENT}/dismiss`,
    handle((ctx, actor) => json(service.dismiss(actor, id(ctx))), true),
  );
  router.post(
    `${AGENT}/recall`,
    handle((ctx, actor) => json(service.recall(actor, id(ctx))), true),
  );
  router.post(
    `${AGENT}/seen`,
    handle((ctx, actor) => {
      service.seen(actor, id(ctx));
      return new Response(null, { status: 204 });
    }, true),
  );
}
