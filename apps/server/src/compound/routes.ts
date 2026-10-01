/**
 * Compound REST (SPEC §9.1; protocol `compound.ts`). Session-cookie auth;
 * writes need a same-origin request. Owners and admins build, move and
 * remove rooms; anyone signed in reads the layout.
 *
 *   GET    /api/compound                    layout + room summaries
 *   POST   /api/compound/check              placement check for the build-mode ghost
 *   POST   /api/compound/rooms              place a new room: creates the floor and clones its repos
 *   PATCH  /api/compound/rooms/:floorId     move/resize (409 while robots run in it)
 *   DELETE /api/compound/rooms/:floorId     remove = floor delete (#150), `{ confirmName }`
 */
import {
  CheckPlacementRequest,
  COMPOUND_API_PATH,
  COMPOUND_CHECK_API_PATH,
  COMPOUND_ROOMS_API_PATH,
  DeleteFloorRequest,
  MoveRoomRequest,
  PlaceRoomRequest,
} from "@regulus/protocol";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import type { FloorActor } from "../floors/access.ts";
import type { FloorLifecycle } from "../floors/lifecycle.ts";
import { readBody } from "../floors/routes.ts";
import type { FloorService } from "../floors/service.ts";
import { json, type RouteContext, type RouteHandler, type Router } from "../http/router.ts";
import type { CompoundService } from "./service.ts";

export interface CompoundRouteDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  compound: CompoundService;
  floors: FloorService;
  lifecycle: FloorLifecycle;
}

export function mountCompoundRoutes(router: Router, deps: CompoundRouteDeps): void {
  const { auth, compound, floors, lifecycle } = deps;

  const route =
    (
      handler: (ctx: RouteContext, actor: FloorActor) => Promise<Response> | Response,
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

  const floorId = (ctx: RouteContext) => ctx.params.floorId ?? "";

  router.get(
    COMPOUND_API_PATH,
    route(() => json(compound.layoutResponse())),
  );

  router.post(
    COMPOUND_CHECK_API_PATH,
    route(async (ctx, actor) => {
      const body = await readBody(ctx.request, CheckPlacementRequest);
      return json(compound.check(actor, body.placement, body.floorId));
    }, true),
  );

  router.post(
    COMPOUND_ROOMS_API_PATH,
    route(async (ctx, actor) => {
      const { placement, ...input } = await readBody(ctx.request, PlaceRoomRequest);
      const { floor } = floors.create(actor, input, placement);
      const room = compound.layoutResponse().rooms.find((r) => r.floorId === floor.floorId);
      return json({ floor, room }, { status: 201 });
    }, true),
  );

  router.add(
    "PATCH",
    `${COMPOUND_ROOMS_API_PATH}/:floorId`,
    route(async (ctx, actor) => {
      const body = await readBody(ctx.request, MoveRoomRequest);
      return json(compound.move(actor, floorId(ctx), body.placement));
    }, true),
  );

  router.add(
    "DELETE",
    `${COMPOUND_ROOMS_API_PATH}/:floorId`,
    route(async (ctx, actor) => {
      const body = await readBody(ctx.request, DeleteFloorRequest);
      await lifecycle.delete(actor, floorId(ctx), body.confirmName);
      return new Response(null, { status: 204 });
    }, true),
  );
}
