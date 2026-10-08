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
 *   PUT    /api/operations/:operationId/members/:userId          narrow a person's access (manage)
 *   DELETE /api/operations/:operationId/members/:userId          lift that limit (manage)
 *   POST   /api/operations/:operationId/repos/:repoId/clone      retry a failed clone (manage)
 *   GET    /api/users                                    office people to pick (manage any operation)
 *
 * Every operation-scoped route answers through operations/access.ts: a room
 * opens with the caller's own GitHub permission on its repo (D27; #270), and
 * "owner/admin" above means the office role on top of that, never instead.
 *
 * Repo tokens are accepted in bodies and never echoed back.
 */
import {
  DeleteOperationRequest,
  OFFICE_USERS_API_PATH,
  OPERATIONS_API_PATH,
  OPERATIONS_ARCHIVED_API_PATH,
  RetryCloneRequest,
  SetOperationMemberRequest,
} from "@regulus/protocol";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import { readJsonBody } from "../http/body.ts";
import { json, type RouteContext, type RouteHandler, type Router } from "../http/router.ts";
import type { OperationActor } from "./access.ts";
import { CreateOperationBody } from "./body.ts";
import type { OperationLifecycle } from "./lifecycle.ts";
import type { OperationService } from "./service.ts";

/**
 * Bodies go through the shared capped reader (http/body.ts), 64 KB by default
 * (a create request with 8 repos and PATs is ~5 KB). `readBody` stays exported
 * from here for routes on other branches that still import it; new code
 * imports `readJsonBody` from http/body.ts.
 */
export { readJsonBody as readBody };

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
      const body = await readJsonBody(ctx.request, CreateOperationBody);
      const { operation } = await operations.createChecked(actor, body);
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
      const body = await readJsonBody(ctx.request, SetOperationMemberRequest);
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
      const body = await readJsonBody(ctx.request, RetryCloneRequest);
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
      const body = await readJsonBody(ctx.request, DeleteOperationRequest);
      await lifecycle.delete(actor, operationId(ctx), body.confirmName);
      return new Response(null, { status: 204 });
    }, true),
  );
}
