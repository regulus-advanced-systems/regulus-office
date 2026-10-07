/**
 * REST for people and their office agents (#271). Paths and shapes are in
 * `@regulus/protocol` office-agents.ts; the rules are service.ts.
 *
 *   GET    /api/office-agents                       the agents the caller may see, caps, engines
 *   POST   /api/office-agents                       create (shared: admins; personal: oneself)
 *   PATCH  /api/office-agents/:id                   role, preset, model, credential, instructions
 *   DELETE /api/office-agents/:id
 *   PUT    /api/office-agents/:id/grants            shared agents: operations and access
 *   POST   /api/office-agents/:id/tokens            mint a token (shown once)
 *   DELETE /api/office-agents/:id/tokens/:tokenId
 *   POST   /api/office-agents/:id/start | /stop
 *   GET    /api/office-agents/:id/conversation      the caller's own conversation with it
 *   POST   /api/office-agents/:id/messages          say something to it
 *   GET    /api/office-agents/requests              the caller's pending "ask a human" questions
 *   POST   /api/office-agents/requests/:id/answer
 *   GET    /api/office-agents/settings | PUT        caps (PUT: owners and admins)
 *   GET    /api/office-agents/runs-on               what the caller can run an agent on (names, never keys)
 *   .../:id/soul, .../:id/memories                  its soul, memories and notes: mind/routes.ts (#136)
 *
 * Session cookie on everything; writes need a same-origin request.
 */
import {
  AnswerHumanRequest,
  CreateOfficeAgent,
  CreateOfficeAgentToken,
  OFFICE_AGENT_REQUESTS_API_PATH,
  OFFICE_AGENT_RUNS_ON_API_PATH,
  OFFICE_AGENT_SETTINGS_API_PATH,
  OFFICE_AGENTS_API_PATH,
  OfficeAgentSettings,
  SendOfficeAgentMessage,
  SetOfficeAgentGrants,
  UpdateOfficeAgent,
} from "@regulus/protocol";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import { readJsonBody } from "../http/body.ts";
import { json, type RouteContext, type Router } from "../http/router.ts";
import type { OperationActor } from "../operations/access.ts";
import type { MindService } from "./mind/people.ts";
import { mountMindRoutes } from "./mind/routes.ts";
import type { OfficeAgentService } from "./service.ts";

export interface OfficeAgentRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  service: OfficeAgentService;
  /** The agent's soul, memories and notes (#136; mind/routes.ts). */
  mind: MindService;
}

const AGENT = `${OFFICE_AGENTS_API_PATH}/:id`;

export type PersonHandler = (
  fn: (ctx: RouteContext, actor: OperationActor) => Promise<Response> | Response,
  write?: boolean,
) => (ctx: RouteContext) => Promise<Response>;

/** A route for a signed-in person; a write also needs a same-origin request. */
export function personHandler(auth: OfficeAgentRoutesDeps["auth"]): PersonHandler {
  return (fn, write = false) =>
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
        return await fn(ctx, { id: user.id, role: user.role });
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        throw err;
      }
    };
}

export function mountOfficeAgentRoutes(router: Router, deps: OfficeAgentRoutesDeps): void {
  const { auth, service } = deps;

  const handle = personHandler(auth);
  const id = (ctx: RouteContext) => ctx.params.id ?? "";
  const noContent = () => new Response(null, { status: 204 });
  mountMindRoutes(router, handle, deps.mind);

  // Fixed paths before `/:id` ones.
  router.get(
    OFFICE_AGENT_SETTINGS_API_PATH,
    handle(() => json(service.settings())),
  );
  router.add(
    "PUT",
    OFFICE_AGENT_SETTINGS_API_PATH,
    handle(async (ctx, actor) => {
      const settings = await readJsonBody(ctx.request, OfficeAgentSettings);
      return json(service.saveSettings(actor, settings));
    }, true),
  );
  router.get(
    OFFICE_AGENT_RUNS_ON_API_PATH,
    handle((_ctx, actor) =>
      json(service.runsOn(actor), { headers: { "cache-control": "no-store" } }),
    ),
  );
  router.get(
    OFFICE_AGENT_REQUESTS_API_PATH,
    handle((_ctx, actor) => json({ requests: service.pendingRequests(actor) })),
  );
  router.post(
    `${OFFICE_AGENT_REQUESTS_API_PATH}/:id/answer`,
    handle(async (ctx, actor) => {
      const { answer } = await readJsonBody(ctx.request, AnswerHumanRequest);
      return json(await service.answer(actor, id(ctx), answer));
    }, true),
  );

  router.get(
    OFFICE_AGENTS_API_PATH,
    handle((_ctx, actor) => json(service.list(actor))),
  );
  router.post(
    OFFICE_AGENTS_API_PATH,
    handle(async (ctx, actor) => {
      const input = await readJsonBody(ctx.request, CreateOfficeAgent);
      return json(service.create(actor, input), { status: 201 });
    }, true),
  );
  router.add(
    "PATCH",
    AGENT,
    handle(async (ctx, actor) => {
      const patch = await readJsonBody(ctx.request, UpdateOfficeAgent);
      return json(await service.update(actor, id(ctx), patch));
    }, true),
  );
  router.add(
    "DELETE",
    AGENT,
    handle(async (ctx, actor) => {
      await service.remove(actor, id(ctx));
      return noContent();
    }, true),
  );
  router.add(
    "PUT",
    `${AGENT}/grants`,
    handle(async (ctx, actor) => {
      const { grants } = await readJsonBody(ctx.request, SetOfficeAgentGrants);
      return json(service.setGrants(actor, id(ctx), grants));
    }, true),
  );
  router.post(
    `${AGENT}/tokens`,
    handle(async (ctx, actor) => {
      const { label } = await readJsonBody(ctx.request, CreateOfficeAgentToken);
      // The only response that ever carries a token; it must not be cached.
      return json(service.mintToken(actor, id(ctx), label), {
        status: 201,
        headers: { "cache-control": "no-store" },
      });
    }, true),
  );
  router.add(
    "DELETE",
    `${AGENT}/tokens/:tokenId`,
    handle((ctx, actor) => {
      service.revokeToken(actor, id(ctx), ctx.params.tokenId ?? "");
      return noContent();
    }, true),
  );
  router.post(
    `${AGENT}/start`,
    handle(async (ctx, actor) => json(await service.start(actor, id(ctx))), true),
  );
  router.post(
    `${AGENT}/stop`,
    handle(async (ctx, actor) => json(await service.stop(actor, id(ctx))), true),
  );
  router.get(
    `${AGENT}/conversation`,
    handle((ctx, actor) => json(service.conversation(actor, id(ctx)))),
  );
  router.post(
    `${AGENT}/messages`,
    handle(async (ctx, actor) => {
      const { text } = await readJsonBody(ctx.request, SendOfficeAgentMessage);
      return json(await service.send(actor, id(ctx), text), { status: 202 });
    }, true),
  );
}
