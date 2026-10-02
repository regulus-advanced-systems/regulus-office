/**
 * Compound REST (SPEC §9.1; protocol `compound.ts`). Session-cookie auth;
 * writes need a same-origin request. Owners and admins build, move and
 * remove rooms; anyone signed in reads the layout.
 *
 *   GET    /api/compound                    layout + room summaries
 *   POST   /api/compound/check              placement check for the build-mode ghost
 *   POST   /api/compound/rooms              place a new room: creates the operation and clones its repos
 *   PATCH  /api/compound/rooms/:operationId     move/resize (409 while henchmen run in it)
 *   DELETE /api/compound/rooms/:operationId     remove = operation delete (#150), `{ confirmName }`
 */
import {
  CheckPlacementRequest,
  COMPOUND_API_PATH,
  COMPOUND_CHECK_API_PATH,
  COMPOUND_ROOMS_API_PATH,
  DeleteOperationRequest,
  MoveRoomRequest,
  PlaceRoomRequest,
} from "@regulus/protocol";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import { readJsonBody } from "../http/body.ts";
import { json, type RouteContext, type RouteHandler, type Router } from "../http/router.ts";
import type { OperationActor } from "../operations/access.ts";
import type { OperationLifecycle } from "../operations/lifecycle.ts";
import type { OperationService } from "../operations/service.ts";
import type { CompoundService } from "./service.ts";

export interface CompoundRouteDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  compound: CompoundService;
  operations: OperationService;
  lifecycle: OperationLifecycle;
}

export function mountCompoundRoutes(router: Router, deps: CompoundRouteDeps): void {
  const { auth, compound, operations, lifecycle } = deps;

  const route =
    (
      handler: (ctx: RouteContext, actor: OperationActor) => Promise<Response> | Response,
      write = false,
    ): RouteHandler =>
    async (ctx) => {
      try {
        if (write) {
          const check = checkOrigin(ctx.request, auth.publicUrl, {
            allowedOrigins: auth.allowedOrigins,
          });
          if (!check.ok) throw forbidden("origin_mismatch");
        }
        const user = await auth.getSessionFromRequest(ctx.request);
        if (!user) throw unauthorized();
        return await handler(ctx, { id: user.id, role: user.role });
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        throw err;
      }
    };

  const operationId = (ctx: RouteContext) => ctx.params.operationId ?? "";

  router.get(
    COMPOUND_API_PATH,
    route(() => json(compound.layoutResponse())),
  );

  router.post(
    COMPOUND_CHECK_API_PATH,
    route(async (ctx, actor) => {
      const body = await readJsonBody(ctx.request, CheckPlacementRequest);
      return json(compound.check(actor, body.placement, body.operationId));
    }, true),
  );

  router.post(
    COMPOUND_ROOMS_API_PATH,
    route(async (ctx, actor) => {
      const { placement, ...input } = await readJsonBody(ctx.request, PlaceRoomRequest);
      const { operation } = operations.create(actor, input, placement);
      const room = compound
        .layoutResponse()
        .rooms.find((r) => r.operationId === operation.operationId);
      return json({ operation, room }, { status: 201 });
    }, true),
  );

  router.add(
    "PATCH",
    `${COMPOUND_ROOMS_API_PATH}/:operationId`,
    route(async (ctx, actor) => {
      const body = await readJsonBody(ctx.request, MoveRoomRequest);
      return json(compound.move(actor, operationId(ctx), body.placement));
    }, true),
  );

  router.add(
    "DELETE",
    `${COMPOUND_ROOMS_API_PATH}/:operationId`,
    route(async (ctx, actor) => {
      const body = await readJsonBody(ctx.request, DeleteOperationRequest);
      await lifecycle.delete(actor, operationId(ctx), body.confirmName);
      return new Response(null, { status: 204 });
    }, true),
  );
}
