/**
 * Linked task REST (#257; shapes and paths in `@regulus/protocol`
 * linked-tasks.ts, rules in service.ts). Every call needs a session; writes
 * also need a same-origin request. The list answers an empty list for a room
 * the caller cannot see, the same as for a room without linked tasks.
 */
import {
  CreateLinkedTaskRequest,
  LINKED_TASKS_API_PATH,
  type LinkedTaskListResponse,
  SetLinkedAutoNotesRequest,
} from "@regulus/protocol";
import type { OfficeAuth, SessionUser } from "../../auth/auth.ts";
import { AuthHttpError, unauthorized } from "../../auth/errors.ts";
import { checkOrigin } from "../../auth/origin.ts";
import { readJsonBody } from "../../http/body.ts";
import { json, type RouteContext, type Router } from "../../http/router.ts";
import type { Logger } from "../../logging.ts";
import { QueueError, type QueueErrorCode } from "../service.ts";
import type { LinkedTasks } from "./service.ts";

/** A prompt of at most 20 000 characters and a handful of ids. */
const CREATE_BODY_MAX_BYTES = 128 * 1024;
const NO_STORE = { "cache-control": "no-store" };
const STATUS: Record<QueueErrorCode, number> = {
  bad_request: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

export interface LinkedTaskRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  linked: LinkedTasks;
  logger: Logger;
}

export function mountLinkedTaskRoutes(router: Router, deps: LinkedTaskRoutesDeps): void {
  const { auth, linked } = deps;

  const handle =
    (write: boolean, fn: (ctx: RouteContext, user: SessionUser) => unknown | Promise<unknown>) =>
    async (ctx: RouteContext): Promise<Response> => {
      try {
        if (write) {
          const check = checkOrigin(ctx.request, auth.publicUrl, {
            allowedOrigins: auth.allowedOrigins,
          });
          if (!check.ok) throw new AuthHttpError(403, "origin_mismatch");
        }
        const user = await auth.getSessionFromRequest(ctx.request);
        if (!user) throw unauthorized();
        return json(await fn(ctx, user), { headers: NO_STORE });
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        if (err instanceof QueueError) {
          return json({ error: err.code, message: err.message }, { status: STATUS[err.code] });
        }
        deps.logger.error({ err: String(err) }, "linked task request failed");
        return json({ error: "internal", message: "internal error" }, { status: 500 });
      }
    };

  router.get(
    LINKED_TASKS_API_PATH,
    handle(false, ({ url }, user): LinkedTaskListResponse => {
      return { tasks: linked.list(user, url.searchParams.get("operationId") ?? "") };
    }),
  );
  router.post(
    LINKED_TASKS_API_PATH,
    handle(true, async ({ request }, user) => {
      const body = await readJsonBody(request, CreateLinkedTaskRequest, {
        maxBytes: CREATE_BODY_MAX_BYTES,
      });
      return linked.create(user, body);
    }),
  );
  router.post(
    `${LINKED_TASKS_API_PATH}/:id/stop`,
    handle(true, ({ params }, user) => linked.stop(user, params.id ?? "")),
  );
  router.post(
    `${LINKED_TASKS_API_PATH}/:id/notes/:noteId/release`,
    handle(true, ({ params }, user) =>
      linked.releaseNote(user, params.id ?? "", params.noteId ?? ""),
    ),
  );
  router.add(
    "PUT",
    `${LINKED_TASKS_API_PATH}/:id/notes/auto`,
    handle(true, async ({ request, params }, user) => {
      const body = await readJsonBody(request, SetLinkedAutoNotesRequest, { maxBytes: 1024 });
      return linked.setAutoNotes(user, params.id ?? "", body.on);
    }),
  );
}
