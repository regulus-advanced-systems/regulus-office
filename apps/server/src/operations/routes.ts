/**
 * REST for operations (SPEC §5, §9.1). Session-cookie auth; state changes also
 * need a same-origin request (CSRF), like the auth routes.
 *
 *   GET    /api/operations                                   operations the caller can see
 *   POST   /api/operations                                   create (owner/admin)
 *   GET    /api/operations/:operationId                          one operation (view)
 *   GET    /api/operations/archived                          archived operations (owner/admin)
 *   POST   /api/operations/:operationId/archive                  archive (owner/admin)
 *   POST   /api/operations/:operationId/restore                  restore (owner/admin)
 *   POST   /api/operations/:operationId/send-home                send its henchmen home (owner/admin)
 *   DELETE /api/operations/:operationId                          delete for good (owner/admin; #150)
 *   GET    /api/operations/:operationId/members                  members (manage)
 *   PUT    /api/operations/:operationId/members/:userId          grant access (manage)
 *   DELETE /api/operations/:operationId/members/:userId          revoke (manage)
 *   POST   /api/operations/:operationId/repos/:repoId/clone      retry a failed clone (manage)
 *   GET    /api/users                                    office people to grant (manage any operation)
 *
 * Repo tokens are accepted in bodies and never echoed back.
 */
import {
  CreateOperationRequest,
  DeleteOperationRequest,
  OFFICE_USERS_API_PATH,
  OPERATIONS_API_PATH,
  OPERATIONS_ARCHIVED_API_PATH,
  RetryCloneRequest,
  SetOperationMemberRequest,
} from "@regulus/protocol";
import type { z } from "zod";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import { json, type RouteContext, type RouteHandler, type Router } from "../http/router.ts";
import type { OperationActor } from "./access.ts";
import type { OperationLifecycle } from "./lifecycle.ts";
import type { OperationService } from "./service.ts";

/** Largest accepted JSON body; a create request with 8 repos and PATs is ~5 KB. */
const MAX_BODY_BYTES = 64 * 1024;

export async function readBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.output<S>> {
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

export function mountOperationRoutes(
  router: Router,
  deps: {
    auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
    operations: OperationService;
    lifecycle?: OperationLifecycle;
  },
): void {
  const { auth, operations, lifecycle } = deps;

  const actorOf = async (request: Request): Promise<OperationActor> => {
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
      handler: (ctx: RouteContext, actor: OperationActor) => Promise<Response> | Response,
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
    OPERATIONS_API_PATH,
    route((_ctx, actor) => json({ operations: operations.list(actor) })),
  );

  router.post(
    OPERATIONS_API_PATH,
    route(async (ctx, actor) => {
      const body = await readBody(ctx.request, CreateOperationRequest);
      const { operation } = operations.create(actor, body);
      return json(operation, { status: 201 });
    }, true),
  );

  // Before `/:operationId`: the first matching route wins.
  if (lifecycle) {
    router.get(
      OPERATIONS_ARCHIVED_API_PATH,
      route((_ctx, actor) => json({ operations: lifecycle.listArchived(actor) })),
    );
  }

  router.get(
    `${OPERATIONS_API_PATH}/:operationId`,
    route((ctx, actor) => json(operations.get(actor, param(ctx, "operationId")))),
  );

  router.post(
    `${OPERATIONS_API_PATH}/:operationId/archive`,
    route((ctx, actor) => {
      operations.archive(actor, param(ctx, "operationId"));
      return new Response(null, { status: 204 });
    }, true),
  );

  if (lifecycle) mountLifecycleRoutes(router, route, lifecycle);

  router.get(
    `${OPERATIONS_API_PATH}/:operationId/members`,
    route((ctx, actor) => json({ members: operations.members(actor, param(ctx, "operationId")) })),
  );

  router.get(
    OFFICE_USERS_API_PATH,
    route((_ctx, actor) => json({ users: operations.people(actor) })),
  );

  router.add(
    "PUT",
    `${OPERATIONS_API_PATH}/:operationId/members/:userId`,
    route(async (ctx, actor) => {
      const body = await readBody(ctx.request, SetOperationMemberRequest);
      operations.setMember(actor, param(ctx, "operationId"), param(ctx, "userId"), body.access);
      return new Response(null, { status: 204 });
    }, true),
  );

  router.add(
    "DELETE",
    `${OPERATIONS_API_PATH}/:operationId/members/:userId`,
    route((ctx, actor) => {
      operations.removeMember(actor, param(ctx, "operationId"), param(ctx, "userId"));
      return new Response(null, { status: 204 });
    }, true),
  );

  router.post(
    `${OPERATIONS_API_PATH}/:operationId/repos/:repoId/clone`,
    route(async (ctx, actor) => {
      const body = await readBody(ctx.request, RetryCloneRequest);
      const { repo } = operations.retryClone(
        actor,
        param(ctx, "operationId"),
        param(ctx, "repoId"),
        body.token,
      );
      return json(repo, { status: 202 });
    }, true),
  );
}

type Route = (
  handler: (ctx: RouteContext, actor: OperationActor) => Promise<Response> | Response,
  write?: boolean,
) => RouteHandler;

/** Restore, send home and delete (#150); archive stays on the service above. */
function mountLifecycleRoutes(router: Router, route: Route, lifecycle: OperationLifecycle): void {
  const operationId = (ctx: RouteContext) => ctx.params.operationId ?? "";

  router.post(
    `${OPERATIONS_API_PATH}/:operationId/restore`,
    route((ctx, actor) => json(lifecycle.restore(actor, operationId(ctx))), true),
  );

  router.post(
    `${OPERATIONS_API_PATH}/:operationId/send-home`,
    route(async (ctx, actor) => json(await lifecycle.sendAllHome(actor, operationId(ctx))), true),
  );

  router.add(
    "DELETE",
    `${OPERATIONS_API_PATH}/:operationId`,
    route(async (ctx, actor) => {
      const body = await readBody(ctx.request, DeleteOperationRequest);
      await lifecycle.delete(actor, operationId(ctx), body.confirmName);
      return new Response(null, { status: 204 });
    }, true),
  );
}
