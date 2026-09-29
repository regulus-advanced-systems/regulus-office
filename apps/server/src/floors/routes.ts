/**
 * REST for floors (SPEC §5, §9.1). Session-cookie auth; state changes also
 * need a same-origin request (CSRF), like the auth routes.
 *
 *   GET    /api/floors                                   floors the caller can see
 *   POST   /api/floors                                   create (owner/admin)
 *   GET    /api/floors/:floorId                          one floor (view)
 *   POST   /api/floors/:floorId/archive                  archive (owner/admin)
 *   GET    /api/floors/:floorId/members                  members (manage)
 *   PUT    /api/floors/:floorId/members/:userId          grant access (manage)
 *   DELETE /api/floors/:floorId/members/:userId          revoke (manage)
 *   POST   /api/floors/:floorId/repos/:repoId/clone      retry a failed clone (manage)
 *   GET    /api/users                                    office people to grant (manage any floor)
 *
 * Repo tokens are accepted in bodies and never echoed back.
 */
import {
  CreateFloorRequest,
  FLOORS_API_PATH,
  OFFICE_USERS_API_PATH,
  RetryCloneRequest,
  SetFloorMemberRequest,
} from "@regulus/protocol";
import type { z } from "zod";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import { json, type RouteContext, type RouteHandler, type Router } from "../http/router.ts";
import type { FloorActor } from "./access.ts";
import type { FloorService } from "./service.ts";

/** Largest accepted JSON body; a create request with 8 repos and PATs is ~5 KB. */
const MAX_BODY_BYTES = 64 * 1024;

async function readBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new AuthHttpError(413, "body_too_large");
  let raw: unknown;
  try {
    raw = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new AuthHttpError(400, "invalid_json");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Field paths only: zod messages could quote input, and input may hold a token.
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "body"))];
    throw new AuthHttpError(400, "invalid_body", { fields });
  }
  return parsed.data;
}

export function mountFloorRoutes(
  router: Router,
  deps: {
    auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
    floors: FloorService;
  },
): void {
  const { auth, floors } = deps;

  const actorOf = async (request: Request): Promise<FloorActor> => {
    const user = await auth.getSessionFromRequest(request);
    if (!user) throw unauthorized();
    return { id: user.id, role: user.role };
  };

  const sameOrigin = (request: Request) => {
    const check = checkOrigin(request, auth.publicUrl, { allowedOrigins: auth.allowedOrigins });
    if (!check.ok) throw forbidden("origin_mismatch");
  };

  const route =
    (
      handler: (ctx: RouteContext, actor: FloorActor) => Promise<Response> | Response,
      write = false,
    ): RouteHandler =>
    async (ctx) => {
      try {
        if (write) sameOrigin(ctx.request);
        return await handler(ctx, await actorOf(ctx.request));
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        throw err;
      }
    };

  const param = (ctx: RouteContext, name: string) => ctx.params[name] ?? "";

  router.get(
    FLOORS_API_PATH,
    route((_ctx, actor) => json({ floors: floors.list(actor) })),
  );

  router.post(
    FLOORS_API_PATH,
    route(async (ctx, actor) => {
      const body = await readBody(ctx.request, CreateFloorRequest);
      const { floor } = floors.create(actor, body);
      return json(floor, { status: 201 });
    }, true),
  );

  router.get(
    `${FLOORS_API_PATH}/:floorId`,
    route((ctx, actor) => json(floors.get(actor, param(ctx, "floorId")))),
  );

  router.post(
    `${FLOORS_API_PATH}/:floorId/archive`,
    route((ctx, actor) => {
      floors.archive(actor, param(ctx, "floorId"));
      return new Response(null, { status: 204 });
    }, true),
  );

  router.get(
    `${FLOORS_API_PATH}/:floorId/members`,
    route((ctx, actor) => json({ members: floors.members(actor, param(ctx, "floorId")) })),
  );

  router.get(
    OFFICE_USERS_API_PATH,
    route((_ctx, actor) => json({ users: floors.people(actor) })),
  );

  router.add(
    "PUT",
    `${FLOORS_API_PATH}/:floorId/members/:userId`,
    route(async (ctx, actor) => {
      const body = await readBody(ctx.request, SetFloorMemberRequest);
      floors.setMember(actor, param(ctx, "floorId"), param(ctx, "userId"), body.access);
      return new Response(null, { status: 204 });
    }, true),
  );

  router.add(
    "DELETE",
    `${FLOORS_API_PATH}/:floorId/members/:userId`,
    route((ctx, actor) => {
      floors.removeMember(actor, param(ctx, "floorId"), param(ctx, "userId"));
      return new Response(null, { status: 204 });
    }, true),
  );

  router.post(
    `${FLOORS_API_PATH}/:floorId/repos/:repoId/clone`,
    route(async (ctx, actor) => {
      const body = await readBody(ctx.request, RetryCloneRequest);
      const { repo } = floors.retryClone(
        actor,
        param(ctx, "floorId"),
        param(ctx, "repoId"),
        body.token,
      );
      return json(repo, { status: 202 });
    }, true),
  );
}
