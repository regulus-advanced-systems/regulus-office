/**
 * REST for henchman skin rules (#184), owners and admins only:
 *
 *   GET    /api/skin-rules        every rule, best first
 *   POST   /api/skin-rules        add a rule { match, skinId, priority }
 *   PATCH  /api/skin-rules/:id    change match, skin or priority
 *   DELETE /api/skin-rules/:id
 *
 * Writes need a same-origin request and are audited. The OperationRooms
 * republish every henchman's skin after a change (setup.ts).
 */
import { CreateSkinRule, SKIN_RULES_API_PATH, UpdateSkinRule } from "@regulus/protocol";
import { AUDIT_ACTIONS, type AuditAction, writeAudit } from "../auth/audit.ts";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import type { Db } from "../db/index.ts";
import { readJsonBody } from "../http/body.ts";
import { json, type RouteContext, type Router } from "../http/router.ts";
import { isOfficeManager, type OperationActor } from "../operations/access.ts";
import { SkinRuleError, type SkinRuleStore } from "./store.ts";

export interface SkinRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  db: Db;
  rules: SkinRuleStore;
}

const RULE = `${SKIN_RULES_API_PATH}/:id`;

export function mountSkinRoutes(router: Router, deps: SkinRoutesDeps): void {
  const { auth, db, rules } = deps;

  const handle =
    (
      fn: (ctx: RouteContext, actor: OperationActor) => Promise<Response> | Response,
      write = false,
    ) =>
    async (ctx: RouteContext) => {
      try {
        if (write) {
          const check = checkOrigin(ctx.request, auth.publicUrl, {
            allowedOrigins: auth.allowedOrigins,
          });
          if (!check.ok) throw forbidden("origin_mismatch");
        }
        const user = await auth.getSessionFromRequest(ctx.request);
        if (!user) throw unauthorized();
        if (!isOfficeManager(user.role)) throw forbidden("owner_or_admin_required");
        return await fn(ctx, { id: user.id, role: user.role });
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        if (err instanceof SkinRuleError)
          return json({ error: err.code }, { status: err.code === "not_found" ? 404 : 400 });
        throw err;
      }
    };
  const audit = (actor: OperationActor, action: AuditAction, id: string, meta: object) =>
    writeAudit(db, {
      userId: actor.id,
      action,
      targetKind: "skin_rule",
      targetId: id,
      meta: { ...meta },
    });

  router.get(
    SKIN_RULES_API_PATH,
    handle(() => json({ rules: rules.list() })),
  );

  router.post(
    SKIN_RULES_API_PATH,
    handle(async (ctx, actor) => {
      const input = await readJsonBody(ctx.request, CreateSkinRule);
      const rule = rules.create(input, actor.id);
      audit(actor, AUDIT_ACTIONS.skinRuleCreate, rule.id, input);
      return json(rule, { status: 201 });
    }, true),
  );

  router.add(
    "PATCH",
    RULE,
    handle(async (ctx, actor) => {
      const id = ctx.params.id ?? "";
      const patch = await readJsonBody(ctx.request, UpdateSkinRule);
      const rule = rules.update(id, patch);
      audit(actor, AUDIT_ACTIONS.skinRuleUpdate, id, patch);
      return json(rule);
    }, true),
  );

  router.add(
    "DELETE",
    RULE,
    handle((ctx, actor) => {
      const id = ctx.params.id ?? "";
      if (!rules.delete(id)) throw new AuthHttpError(404, "not_found");
      audit(actor, AUDIT_ACTIONS.skinRuleDelete, id, {});
      return new Response(null, { status: 204 });
    }, true),
  );
}
