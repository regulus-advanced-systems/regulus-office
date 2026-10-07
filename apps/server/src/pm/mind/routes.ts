/**
 * REST for people and an agent's soul, memories and notes (#136). Shapes are
 * in `@regulus/protocol` office-agent-mind.ts; who may is mind/people.ts.
 *
 *   GET    /api/office-agents/:id/soul                    the soul as it is now
 *   PUT    /api/office-agents/:id/soul                    save a new version
 *   GET    /api/office-agents/:id/soul/versions           its history, newest first (no text)
 *   GET    /api/office-agents/:id/soul/versions/:version  one version with its text
 *   POST   /api/office-agents/:id/soul/revert             bring a version back as a new one
 *   GET    /api/office-agents/:id/memories?kind=memory|note&q=words
 *   POST   /api/office-agents/:id/memories                add a memory or a note
 *   PATCH  /api/office-agents/:id/memories/:entryId
 *   DELETE /api/office-agents/:id/memories/:entryId
 *
 * Session cookie on everything; writes need a same-origin request. Nothing
 * here is cacheable: the answers are private to whoever may read them.
 */
import {
  CreateMindEntry,
  MIND_ENTRY_KINDS,
  type MindEntryKind,
  MindQuery,
  OFFICE_AGENTS_API_PATH,
  RevertOfficeAgentSoul,
  SaveOfficeAgentSoul,
  UpdateMindEntry,
} from "@regulus/protocol";
import { AuthHttpError } from "../../auth/errors.ts";
import { readJsonBody } from "../../http/body.ts";
import { json, type RouteContext, type Router } from "../../http/router.ts";
import type { PersonHandler } from "../routes.ts";
import type { MindService } from "./people.ts";

const AGENT = `${OFFICE_AGENTS_API_PATH}/:id`;
const PRIVATE = { headers: { "cache-control": "no-store" } };

export function mountMindRoutes(router: Router, handle: PersonHandler, service: MindService) {
  const id = (ctx: RouteContext) => ctx.params.id ?? "";
  const invalid = () => new AuthHttpError(400, "invalid_body");

  router.get(
    `${AGENT}/soul`,
    handle((ctx, actor) => json(service.soul(actor, id(ctx)), PRIVATE)),
  );
  router.add(
    "PUT",
    `${AGENT}/soul`,
    handle(async (ctx, actor) => {
      const input = await readJsonBody(ctx.request, SaveOfficeAgentSoul);
      return json(await service.saveSoul(actor, id(ctx), input), PRIVATE);
    }, true),
  );
  router.get(
    `${AGENT}/soul/versions`,
    handle((ctx, actor) => json({ versions: service.versions(actor, id(ctx)) }, PRIVATE)),
  );
  router.get(
    `${AGENT}/soul/versions/:version`,
    handle((ctx, actor) => {
      const version = Number(ctx.params.version);
      if (!Number.isInteger(version) || version < 1) throw new AuthHttpError(404, "not_found");
      return json(service.version(actor, id(ctx), version), PRIVATE);
    }),
  );
  router.post(
    `${AGENT}/soul/revert`,
    handle(async (ctx, actor) => {
      const { version } = await readJsonBody(ctx.request, RevertOfficeAgentSoul);
      return json(await service.revertSoul(actor, id(ctx), version), PRIVATE);
    }, true),
  );

  router.get(
    `${AGENT}/memories`,
    handle((ctx, actor) => {
      const params = new URL(ctx.request.url).searchParams;
      const kind = params.get("kind") ?? "memory";
      if (!(MIND_ENTRY_KINDS as readonly string[]).includes(kind)) throw invalid();
      const query = MindQuery.safeParse(params.get("q") ?? "");
      if (!query.success) throw invalid();
      return json(service.entries(actor, id(ctx), kind as MindEntryKind, query.data), PRIVATE);
    }),
  );
  router.post(
    `${AGENT}/memories`,
    handle(async (ctx, actor) => {
      const input = await readJsonBody(ctx.request, CreateMindEntry);
      return json(service.addEntry(actor, id(ctx), input), { status: 201, ...PRIVATE });
    }, true),
  );
  router.add(
    "PATCH",
    `${AGENT}/memories/:entryId`,
    handle(async (ctx, actor) => {
      const patch = await readJsonBody(ctx.request, UpdateMindEntry);
      return json(service.updateEntry(actor, id(ctx), ctx.params.entryId ?? "", patch), PRIVATE);
    }, true),
  );
  router.add(
    "DELETE",
    `${AGENT}/memories/:entryId`,
    handle((ctx, actor) => {
      service.removeEntry(actor, id(ctx), ctx.params.entryId ?? "");
      return new Response(null, { status: 204 });
    }, true),
  );
}
