/**
 * REST for room settings (#182). Session-cookie auth; a change also needs a
 * same-origin request (CSRF), like the floor routes.
 *
 *   GET /api/floors/:floorId/room-settings   desk count, decor style, capacity (view)
 *   PUT /api/floors/:floorId/room-settings   change them (room managers)
 *
 * Refusals: 404 no such room (or no access), 403 not a room manager,
 * 400 bad body or `too_many_desks`, 409 `desks_occupied`,
 * `room_not_generated` or `room_size_unknown`.
 */
import { UpdateRoomSettingsRequest } from "@regulus/protocol";
import type { OfficeAuth } from "../../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../../auth/errors.ts";
import { checkOrigin } from "../../auth/origin.ts";
import type { FloorActor } from "../../floors/access.ts";
import { readBody } from "../../floors/routes.ts";
import { json, type RouteContext, type Router } from "../../http/router.ts";
import type { RoomSettingsService } from "./service.ts";

export const ROOM_SETTINGS_ROUTE = "/api/floors/:floorId/room-settings";

export function mountRoomSettingsRoutes(
  router: Router,
  deps: {
    auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
    settings: RoomSettingsService;
  },
): void {
  const { auth, settings } = deps;

  const handle =
    (write: boolean, fn: (ctx: RouteContext, actor: FloorActor) => unknown) =>
    async (ctx: RouteContext): Promise<Response> => {
      try {
        if (write) {
          const check = checkOrigin(ctx.request, auth.publicUrl, {
            allowedOrigins: auth.allowedOrigins,
          });
          if (!check.ok) throw forbidden("origin_mismatch");
        }
        const user = await auth.getSessionFromRequest(ctx.request);
        if (!user) throw unauthorized();
        return json(await fn(ctx, { id: user.id, role: user.role }));
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        throw err;
      }
    };

  router.get(
    ROOM_SETTINGS_ROUTE,
    handle(false, (ctx, actor) => settings.get(actor, ctx.params.floorId ?? "")),
  );
  router.add(
    "PUT",
    ROOM_SETTINGS_ROUTE,
    handle(true, async (ctx, actor) => {
      const body = await readBody(ctx.request, UpdateRoomSettingsRequest);
      return settings.update(actor, ctx.params.floorId ?? "", body);
    }),
  );
}
