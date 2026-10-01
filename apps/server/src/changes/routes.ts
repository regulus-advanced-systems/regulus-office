/**
 * REST for a henchman's changes window (#38); shapes and paths in
 * `@regulus/protocol` changes-api.ts, ACL in acl.ts.
 *
 * Reads need operation visibility (404 otherwise, as for terminals). Commit and
 * discard need the henchman's owner (D12) and a same-origin request, and each
 * is audited (`agent.changes_commit` with the file count and new commit,
 * `agent.changes_discard` with the path; never file contents or the message).
 * Image bytes go out as `application/octet-stream` with `nosniff`, a
 * sandboxing CSP and no caching; the browser checks the magic number again
 * before it makes a blob URL.
 */
import {
  CommitChangesRequest,
  DiscardChangeRequest,
  IMAGE_SIDES,
  type ImageSide,
} from "@regulus/protocol";
import { AUDIT_ACTIONS, writeAudit } from "../auth/audit.ts";
import type { OfficeAuth, SessionUser } from "../auth/auth.ts";
import { AuthHttpError, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import type { Db } from "../db/index.ts";
import { json, type RouteContext, type Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import { operationAccessFor } from "../operations/access.ts";
import { readBody } from "../operations/routes.ts";
import { type ChangesAccess, decideChangesAccess, mayWriteChanges } from "./acl.ts";
import { ChangesHttpError } from "./paths.ts";
import type { AgentRow, ChangesService } from "./service.ts";

export const CHANGES_ROUTE = "/api/agents/:agentId/changes";

export interface ChangesRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  db: Db;
  changes: ChangesService;
  logger: Logger;
}

type Handler = (ctx: RouteContext, user: SessionUser, row: AgentRow) => Promise<Response>;

export function mountChangesRoutes(router: Router, deps: ChangesRoutesDeps): void {
  const { auth, db, changes } = deps;
  const canView = (u: { id: string; role: SessionUser["role"] }, operationId: string) =>
    operationAccessFor(db, u, operationId) !== null;

  const guarded =
    (want: ChangesAccess, handler: Handler) =>
    async (ctx: RouteContext): Promise<Response> => {
      try {
        if (want === "write") {
          const check = checkOrigin(ctx.request, auth.publicUrl, {
            allowedOrigins: auth.allowedOrigins,
          });
          if (!check.ok) throw new ChangesHttpError(403, "origin_mismatch");
        }
        const user = await auth.getSessionFromRequest(ctx.request);
        if (!user) throw unauthorized();
        const row = changes.agent(ctx.params.agentId ?? "");
        if (!row) throw new ChangesHttpError(404, "not_found");
        const decision = decideChangesAccess(user, row, want, canView);
        if (!decision.ok) throw new ChangesHttpError(decision.status, decision.code);
        return await handler(ctx, user, row);
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        if (err instanceof ChangesHttpError) return json(err.toJSON(), { status: err.status });
        deps.logger.error({ err, agentId: ctx.params.agentId }, "changes window request failed");
        return json({ error: "git_failed", message: "internal error" }, { status: 500 });
      }
    };

  router.get(
    CHANGES_ROUTE,
    guarded("view", async (_ctx, user, row) => {
      const look = await changes.look(row);
      return json(
        {
          ...look.snapshot,
          agentId: row.id,
          canWrite: mayWriteChanges(user, row.ownerUserId),
        },
        { headers: { "cache-control": "no-store" } },
      );
    }),
  );

  router.get(
    `${CHANGES_ROUTE}/file`,
    guarded("view", async ({ url }, _user, row) => {
      const diff = await changes.fileDiff(row, url.searchParams.get("path") ?? "");
      return json(diff, { headers: { "cache-control": "no-store" } });
    }),
  );

  router.get(
    `${CHANGES_ROUTE}/blob`,
    guarded("view", async ({ url }, _user, row) => {
      const side = url.searchParams.get("side") ?? "";
      if (!(IMAGE_SIDES as readonly string[]).includes(side)) {
        throw new ChangesHttpError(400, "invalid_body", "side must be base or work");
      }
      const blob = await changes.image(row, url.searchParams.get("path") ?? "", side as ImageSide);
      return new Response(new Blob([blob.bytes as Uint8Array<ArrayBuffer>]), {
        headers: {
          "content-type": "application/octet-stream",
          "x-image-type": blob.type,
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
          "content-disposition": "attachment",
          "cache-control": "no-store",
        },
      });
    }),
  );

  router.post(
    `${CHANGES_ROUTE}/commit`,
    guarded("write", async ({ request }, user, row) => {
      const body = await readBody(request, CommitChangesRequest);
      const result = await changes.commit(row, body, {
        name: user.displayName || "Regulus Office user",
        email: user.email,
      });
      writeAudit(db, {
        userId: user.id,
        action: AUDIT_ACTIONS.agentChangesCommit,
        targetKind: "agent",
        targetId: row.id,
        meta: { files: result.files, sha: result.sha },
      });
      return json(result);
    }),
  );

  router.post(
    `${CHANGES_ROUTE}/discard`,
    guarded("write", async ({ request }, user, row) => {
      const body = await readBody(request, DiscardChangeRequest);
      await changes.discard(row, body);
      writeAudit(db, {
        userId: user.id,
        action: AUDIT_ACTIONS.agentChangesDiscard,
        targetKind: "agent",
        targetId: row.id,
        meta: { path: body.path },
      });
      return json({ discarded: body.path });
    }),
  );
}
