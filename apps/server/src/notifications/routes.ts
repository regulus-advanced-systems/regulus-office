/**
 * REST for notifications (#42).
 *
 *   GET    /api/notifications/attention          my henchmen waiting for me (tab badge)
 *   GET    /api/notifications/prefs              my preferences (signed in)
 *   PUT    /api/notifications/prefs              replace my preferences
 *   GET    /api/notifications/channels           team channels (owners/admins)
 *   POST   /api/notifications/channels           add a channel (URL / bot token write-only)
 *   PATCH  /api/notifications/channels/:id       change routing, label, or replace the secret
 *   DELETE /api/notifications/channels/:id
 *   POST   /api/notifications/channels/:id/test  send a fixed test message once
 *
 * Writes need a same-origin request. No response, log line or audit entry
 * carries a webhook URL or bot token.
 */
import {
  CreateNotificationChannel,
  NOTIFICATION_ATTENTION_API_PATH,
  NOTIFICATION_CHANNELS_API_PATH,
  NOTIFICATION_PREFS_API_PATH,
  NotificationPrefs,
  UpdateNotificationChannel,
} from "@regulus/protocol";
import { AUDIT_ACTIONS, writeAudit } from "../auth/audit.ts";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import type { Db } from "../db/index.ts";
import { json, type RouteContext, type Router } from "../http/router.ts";
import { isOfficeManager, type OperationActor } from "../operations/access.ts";
import { readBody } from "../operations/routes.ts";
import type { NotificationCenter } from "./center.ts";
import { type ChannelStore, ChannelStoreError } from "./channels.ts";
import type { NotificationDirectory } from "./directory.ts";
import { type SenderPolicy, validateSecret } from "./senders.ts";

export interface NotificationRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  db: Db;
  channels: ChannelStore;
  directory: NotificationDirectory;
  center: Pick<NotificationCenter, "sendTest" | "attentionFor">;
  policy: Pick<SenderPolicy, "slackHosts" | "discordHosts" | "allowHttp">;
  now?: () => number;
  /** Minimum time between two tests of one channel. */
  testIntervalMs?: number;
}

const CHANNEL = `${NOTIFICATION_CHANNELS_API_PATH}/:id`;

export function mountNotificationRoutes(router: Router, deps: NotificationRoutesDeps): void {
  const { auth, db, channels, directory, center, policy } = deps;
  const now = deps.now ?? Date.now;
  const lastTest = new Map<string, number>();

  const signedIn = async (request: Request): Promise<OperationActor> => {
    const user = await auth.getSessionFromRequest(request);
    if (!user) throw unauthorized();
    return { id: user.id, role: user.role };
  };
  const handle =
    (
      fn: (ctx: RouteContext, actor: OperationActor) => Promise<Response> | Response,
      opts: { write?: boolean; manager?: boolean } = {},
    ) =>
    async (ctx: RouteContext) => {
      try {
        if (opts.write) {
          const check = checkOrigin(ctx.request, auth.publicUrl, {
            allowedOrigins: auth.allowedOrigins,
          });
          if (!check.ok) throw forbidden("origin_mismatch");
        }
        const actor = await signedIn(ctx.request);
        if (opts.manager && !isOfficeManager(actor.role))
          throw forbidden("owner_or_admin_required");
        return await fn(ctx, actor);
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        if (err instanceof ChannelStoreError) {
          const status = err.code === "not_found" ? 404 : 400;
          return json({ error: err.code }, { status });
        }
        throw err;
      }
    };
  const audit = (
    actor: OperationActor,
    action: "create" | "update" | "delete",
    id: string,
    meta: Record<string, unknown>,
  ) =>
    writeAudit(db, {
      userId: actor.id,
      action:
        action === "create"
          ? AUDIT_ACTIONS.notificationChannelCreate
          : action === "update"
            ? AUDIT_ACTIONS.notificationChannelUpdate
            : AUDIT_ACTIONS.notificationChannelDelete,
      targetKind: "notification_channel",
      targetId: id,
      meta,
    });
  const checkSecret = (kind: Parameters<typeof validateSecret>[0], secret: string) => {
    const problem = validateSecret(kind, secret, policy);
    if (problem) throw new AuthHttpError(400, problem);
  };
  const channelsResponse = () => json({ channels: channels.list(), canStore: channels.canStore });

  router.get(
    NOTIFICATION_ATTENTION_API_PATH,
    handle((_ctx, actor) => json(center.attentionFor(actor.id))),
  );

  router.get(
    NOTIFICATION_PREFS_API_PATH,
    handle((_ctx, actor) => json(directory.prefs(actor.id))),
  );

  router.add(
    "PUT",
    NOTIFICATION_PREFS_API_PATH,
    handle(
      async (ctx, actor) => {
        const prefs = await readBody(ctx.request, NotificationPrefs);
        // Other henchmen's errors are only for owners and admins.
        if (!isOfficeManager(actor.role)) prefs.adminErrors = false;
        directory.setPrefs(actor.id, prefs);
        return json(prefs);
      },
      { write: true },
    ),
  );

  router.get(
    NOTIFICATION_CHANNELS_API_PATH,
    handle(() => channelsResponse(), { manager: true }),
  );

  router.post(
    NOTIFICATION_CHANNELS_API_PATH,
    handle(
      async (ctx, actor) => {
        const input = await readBody(ctx.request, CreateNotificationChannel);
        if (!channels.canStore) throw new AuthHttpError(400, "master_key_required");
        checkSecret(input.kind, input.secret);
        const view = channels.create(input, actor.id);
        audit(actor, "create", view.id, {
          kind: view.kind,
          label: view.label,
          events: view.events,
          operations: view.operationIds?.length ?? "all",
        });
        return json(view, { status: 201 });
      },
      { write: true, manager: true },
    ),
  );

  router.add(
    "PATCH",
    CHANNEL,
    handle(
      async (ctx, actor) => {
        const id = ctx.params.id ?? "";
        const patch = await readBody(ctx.request, UpdateNotificationChannel);
        const existing = channels.get(id);
        if (!existing) throw new AuthHttpError(404, "not_found");
        if (patch.secret !== undefined) {
          if (!channels.canStore) throw new AuthHttpError(400, "master_key_required");
          checkSecret(existing.kind, patch.secret);
        }
        const view = channels.update(id, patch);
        const { secret, ...changed } = patch;
        audit(actor, "update", id, {
          fields: Object.keys(changed),
          secretReplaced: secret !== undefined,
        });
        return json(view);
      },
      { write: true, manager: true },
    ),
  );

  router.add(
    "DELETE",
    CHANNEL,
    handle(
      (ctx, actor) => {
        const id = ctx.params.id ?? "";
        if (!channels.delete(id)) throw new AuthHttpError(404, "not_found");
        audit(actor, "delete", id, {});
        return new Response(null, { status: 204 });
      },
      { write: true, manager: true },
    ),
  );

  router.post(
    `${CHANNEL}/test`,
    handle(
      async (ctx) => {
        const id = ctx.params.id ?? "";
        if (!channels.get(id)) throw new AuthHttpError(404, "not_found");
        const t = now();
        const last = lastTest.get(id);
        if (last !== undefined && t - last < (deps.testIntervalMs ?? 5_000)) {
          throw new AuthHttpError(429, "too_many_tests");
        }
        lastTest.set(id, t);
        return json(await center.sendTest(id));
      },
      { write: true, manager: true },
    ),
  );
}
