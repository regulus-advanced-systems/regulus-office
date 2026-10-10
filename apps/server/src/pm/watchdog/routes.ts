/**
 * REST for the watchdog (#253); rules in service.ts, shapes in
 * `@regulus/protocol` watchdog.ts.
 *
 *   GET    /api/watchdog                       the report: rounds and findings the caller may see
 *   POST   /api/watchdog/rounds                do a round now (owners and admins)
 *   POST   /api/watchdog/findings/:id/fix      open the draft PR for a proposed fix, or decline
 *   POST   /api/watchdog/findings/:id/noise    a person marks a fault as known noise, or takes it back
 *   GET    /api/watchdog/settings              targets and the fix rule (owners and admins)
 *   PATCH  /api/watchdog/settings              also takes the Sentry token (write-only)
 *   PUT    /api/watchdog/sentry-projects
 *   POST   /api/watchdog/hosts                 a host with its SSH key (write-only) and its PM2 apps
 *   PUT    /api/watchdog/hosts/:id
 *   POST   /api/watchdog/hosts/:id/accept-key  an admin accepts the key the host shows now
 *   DELETE /api/watchdog/hosts/:id
 *
 * Session cookie on everything; writes need a same-origin request. No
 * response carries a key or a token, and no error quotes a request body.
 */
import {
  DecideWatchdogFix,
  MarkWatchdogNoise,
  SaveWatchdogHost,
  SetWatchdogSentryProjects,
  UpdateWatchdogSettings,
  WATCHDOG_API_PATH,
  WATCHDOG_HOSTS_API_PATH,
  WATCHDOG_NEWS_API_PATH,
  WATCHDOG_ROUNDS_API_PATH,
  WATCHDOG_SENTRY_PROJECTS_API_PATH,
  WATCHDOG_SETTINGS_API_PATH,
} from "@regulus/protocol";
import type { OfficeAuth } from "../../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../../auth/errors.ts";
import { checkOrigin } from "../../auth/origin.ts";
import { readJsonBody } from "../../http/body.ts";
import { json, type RouteContext, type Router } from "../../http/router.ts";
import type { OperationActor } from "../../operations/access.ts";
import { WatchdogError } from "./errors.ts";
import type { WatchdogService } from "./service.ts";
import type { WatchdogSettingsService } from "./settings-service.ts";

export interface WatchdogRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  service: WatchdogService;
  settings: WatchdogSettingsService;
}

const NO_STORE = { headers: { "cache-control": "no-store" } };

export function mountWatchdogRoutes(router: Router, deps: WatchdogRoutesDeps): void {
  const { auth, service, settings } = deps;
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
        return await fn(ctx, { id: user.id, role: user.role });
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        if (err instanceof WatchdogError) {
          return json(
            { error: err.code, ...(err.message !== err.code ? { message: err.message } : {}) },
            { status: err.status },
          );
        }
        throw err;
      }
    };
  const id = (ctx: RouteContext) => ctx.params.id ?? "";

  router.get(
    WATCHDOG_API_PATH,
    handle((_ctx, actor) => json(service.report(actor), NO_STORE)),
  );
  router.post(
    WATCHDOG_NEWS_API_PATH,
    handle((_ctx, actor) => json(service.news(actor), NO_STORE), true),
  );
  router.post(
    WATCHDOG_ROUNDS_API_PATH,
    handle(async (_ctx, actor) => json(await service.runNow(actor), { status: 202 }), true),
  );
  router.post(
    `${WATCHDOG_API_PATH}/findings/:id/fix`,
    handle(async (ctx, actor) => {
      const { decision } = await readJsonBody(ctx.request, DecideWatchdogFix);
      return json(service.decideFix(actor, id(ctx), decision));
    }, true),
  );

  router.post(
    `${WATCHDOG_API_PATH}/findings/:id/noise`,
    handle(async (ctx, actor) => {
      const { noise } = await readJsonBody(ctx.request, MarkWatchdogNoise);
      return json(service.markNoise(actor, id(ctx), noise));
    }, true),
  );

  router.get(
    WATCHDOG_SETTINGS_API_PATH,
    handle((_ctx, actor) => json(settings.view(actor), NO_STORE)),
  );
  router.add(
    "PATCH",
    WATCHDOG_SETTINGS_API_PATH,
    handle(async (ctx, actor) => {
      const input = await readJsonBody(ctx.request, UpdateWatchdogSettings);
      return json(settings.update(actor, input), NO_STORE);
    }, true),
  );
  router.add(
    "PUT",
    WATCHDOG_SENTRY_PROJECTS_API_PATH,
    handle(async (ctx, actor) => {
      const input = await readJsonBody(ctx.request, SetWatchdogSentryProjects);
      return json(settings.setSentryProjects(actor, input), NO_STORE);
    }, true),
  );
  router.post(
    WATCHDOG_HOSTS_API_PATH,
    handle(async (ctx, actor) => {
      const input = await readJsonBody(ctx.request, SaveWatchdogHost);
      return json(settings.saveHost(actor, undefined, input), { status: 201, ...NO_STORE });
    }, true),
  );
  router.add(
    "PUT",
    `${WATCHDOG_HOSTS_API_PATH}/:id`,
    handle(async (ctx, actor) => {
      const input = await readJsonBody(ctx.request, SaveWatchdogHost);
      return json(settings.saveHost(actor, id(ctx), input), NO_STORE);
    }, true),
  );
  router.post(
    `${WATCHDOG_HOSTS_API_PATH}/:id/accept-key`,
    handle((ctx, actor) => json(settings.acceptHostKey(actor, id(ctx)), NO_STORE), true),
  );
  router.add(
    "DELETE",
    `${WATCHDOG_HOSTS_API_PATH}/:id`,
    handle((ctx, actor) => {
      // Still there when apps of it are kept as "not watched": the client reads the settings again.
      settings.deleteHost(actor, id(ctx));
      return new Response(null, { status: 204 });
    }, true),
  );
}
