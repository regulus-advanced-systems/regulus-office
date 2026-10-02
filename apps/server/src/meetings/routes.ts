/**
 * Meeting room REST (#50; shapes and paths in `@regulus/protocol`
 * meetings-api.ts, rules in service.ts). Reads need a session and operation
 * visibility (404 otherwise); writes also need a same-origin request, and the
 * start body is read through the shared capped reader (#240).
 */
import {
  MEETING_ACTIONS,
  MEETINGS_ACTIVE_PATH,
  MEETINGS_API_PATH,
  type MeetingAction,
  StartMeetingRequest,
} from "@regulus/protocol";
import type { OfficeAuth, SessionUser } from "../auth/auth.ts";
import { AuthHttpError, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import { readJsonBody } from "../http/body.ts";
import { json, type RouteContext, type Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import { MeetingError, type MeetingService } from "./service.ts";

/** A start names up to five members and a topic of at most 20 000 characters. */
const START_BODY_MAX_BYTES = 128 * 1024;

export interface MeetingRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  meetings: MeetingService;
  logger: Logger;
}

const NO_STORE = { "cache-control": "no-store" };

export function mountMeetingRoutes(router: Router, deps: MeetingRoutesDeps): void {
  const { auth, meetings } = deps;

  const handle =
    (write: boolean, fn: (ctx: RouteContext, user: SessionUser) => unknown | Promise<unknown>) =>
    async (ctx: RouteContext): Promise<Response> => {
      try {
        if (write) {
          const check = checkOrigin(ctx.request, auth.publicUrl, {
            allowedOrigins: auth.allowedOrigins,
          });
          if (!check.ok) throw new MeetingError(403, "origin_mismatch", "cross-origin request");
        }
        const user = await auth.getSessionFromRequest(ctx.request);
        if (!user) throw unauthorized();
        return json(await fn(ctx, user), { headers: NO_STORE });
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        if (err instanceof MeetingError) {
          return json({ error: err.code, message: err.message }, { status: err.status });
        }
        deps.logger.error({ err: String(err) }, "meeting request failed");
        return json({ error: "internal", message: "internal error" }, { status: 500 });
      }
    };

  router.get(
    MEETINGS_API_PATH,
    handle(false, ({ url }, user) =>
      meetings.list(user, url.searchParams.get("operationId") ?? ""),
    ),
  );
  router.get(
    MEETINGS_ACTIVE_PATH,
    handle(false, (_ctx, user) => meetings.active(user)),
  );
  router.post(
    MEETINGS_API_PATH,
    handle(true, async ({ request }, user) => {
      const body = await readJsonBody(request, StartMeetingRequest, {
        maxBytes: START_BODY_MAX_BYTES,
      });
      return meetings.start(user, body);
    }),
  );
  router.get(
    `${MEETINGS_API_PATH}/:id`,
    handle(false, ({ params }, user) => meetings.detail(user, params.id ?? "")),
  );
  router.post(
    `${MEETINGS_API_PATH}/:id/:action`,
    handle(true, ({ params }, user) => {
      const action = params.action as MeetingAction;
      if (!MEETING_ACTIONS.includes(action)) {
        throw new MeetingError(404, "not_found", "no such meeting action");
      }
      const id = params.id ?? "";
      if (action === "pause") return meetings.pause(user, id);
      if (action === "resume") return meetings.resume(user, id);
      return meetings.stop(user, id);
    }),
  );
}
