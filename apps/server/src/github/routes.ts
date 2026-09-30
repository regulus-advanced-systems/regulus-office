/**
 * REST for the office's GitHub connection (#141). Owners and admins only;
 * state changes need a same-origin request, and the manifest callback needs
 * the one-time `state` issued to the same signed-in user (CSRF).
 *
 *   GET    /api/github/connection     status (never a secret)
 *   DELETE /api/github/connection     disconnect the stored connection
 *   PUT    /api/github/pat            connect with an org fine-grained PAT
 *   POST   /api/github/app/manifest   start the GitHub App manifest flow
 *   GET    /api/github/app/callback   GitHub → office: code + state
 *   GET    /api/github/app/installed  GitHub → office after installing the app
 *   GET    /api/github/repos          repos the connection can see (Add floor)
 */
import {
  ConnectPatRequest,
  GITHUB_APP_SETUP_PATH,
  GITHUB_CONNECTION_API_PATH,
  GITHUB_MANIFEST_API_PATH,
  GITHUB_MANIFEST_CALLBACK_PATH,
  GITHUB_PAT_API_PATH,
  GITHUB_REPOS_API_PATH,
  GITHUB_RESULT_PARAM,
  StartManifestRequest,
} from "@regulus/protocol";
import { AUDIT_ACTIONS, writeAudit } from "../auth/audit.ts";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import type { Db } from "../db/index.ts";
import { type FloorActor, isOfficeManager } from "../floors/access.ts";
import { readBody } from "../floors/routes.ts";
import { json, type RouteContext, type Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import type { GitHubConnection } from "./connection.ts";
import { buildManifest, convertManifest, type ManifestStates, manifestAction } from "./manifest.ts";

export interface GitHubRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  db: Db;
  connection: GitHubConnection;
  states: ManifestStates;
  /** github.com, where the browser posts the manifest. */
  webBase: string;
  logger: Logger;
  /** After the connection changed (board sync resyncs, webhook config is checked; #35). */
  onConnectionChanged?: () => void;
}

export function mountGitHubRoutes(router: Router, deps: GitHubRoutesDeps): void {
  const { auth, db, connection, states, logger } = deps;
  const changed = () => {
    connection.reset();
    deps.onConnectionChanged?.();
  };
  const publicBase = auth.publicUrl.replace(/\/+$/, "");

  const manager = async (request: Request): Promise<FloorActor> => {
    const user = await auth.getSessionFromRequest(request);
    if (!user) throw unauthorized();
    if (!isOfficeManager(user.role)) throw forbidden("owner_or_admin_required");
    return { id: user.id, role: user.role };
  };
  const sameOrigin = (request: Request) => {
    const check = checkOrigin(request, auth.publicUrl, { allowedOrigins: auth.allowedOrigins });
    if (!check.ok) throw forbidden("origin_mismatch");
  };
  const handle =
    (fn: (ctx: RouteContext, actor: FloorActor) => Promise<Response>, write = false) =>
    async (ctx: RouteContext) => {
      try {
        if (write) sameOrigin(ctx.request);
        return await fn(ctx, await manager(ctx.request));
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        throw err;
      }
    };
  const assertChangeable = () => {
    if (connection.managedByEnv) throw new AuthHttpError(409, "managed_by_env");
    if (!connection.store.canStore) throw new AuthHttpError(400, "master_key_required");
  };
  const audit = (actor: FloorActor, action: "connect" | "disconnect", meta: object) =>
    writeAudit(db, {
      userId: actor.id,
      action: action === "connect" ? AUDIT_ACTIONS.githubConnect : AUDIT_ACTIONS.githubDisconnect,
      targetKind: "github_connection",
      targetId: null,
      meta: { ...meta },
    });
  const toOffice = (result: string) =>
    new Response(null, {
      status: 303,
      headers: {
        location: `${publicBase}/office?${GITHUB_RESULT_PARAM}=${encodeURIComponent(result)}`,
        "cache-control": "no-store",
      },
    });

  router.get(
    GITHUB_CONNECTION_API_PATH,
    handle(async () => json(await connection.status())),
  );

  router.get(
    GITHUB_REPOS_API_PATH,
    handle(async () => {
      try {
        return json(await connection.listRepos());
      } catch (err) {
        return json(
          { error: "github_unavailable", detail: connection.describeError(err) },
          { status: 502 },
        );
      }
    }),
  );

  router.add(
    "PUT",
    GITHUB_PAT_API_PATH,
    handle(async (ctx, actor) => {
      assertChangeable();
      const { token } = await readBody(ctx.request, ConnectPatRequest);
      let checked: { login: string | null; repoCount: number };
      try {
        checked = await connection.verifyPat(token);
      } catch (err) {
        return json(
          { error: "github_rejected", detail: connection.describeError(err) },
          { status: 400 },
        );
      }
      connection.store.savePat(token, checked.login);
      changed();
      audit(actor, "connect", { kind: "pat", login: checked.login, repos: checked.repoCount });
      return json(await connection.status());
    }, true),
  );

  router.add(
    "DELETE",
    GITHUB_CONNECTION_API_PATH,
    handle(async (_ctx, actor) => {
      if (connection.managedByEnv) throw new AuthHttpError(409, "managed_by_env");
      const removed = connection.store.clear();
      changed();
      if (removed) audit(actor, "disconnect", {});
      return new Response(null, { status: 204 });
    }, true),
  );

  router.post(
    GITHUB_MANIFEST_API_PATH,
    handle(async (ctx, actor) => {
      assertChangeable();
      const { org } = await readBody(ctx.request, StartManifestRequest);
      const state = states.issue(actor.id);
      return json({
        action: manifestAction(deps.webBase, state, org),
        manifest: JSON.stringify(buildManifest(auth.publicUrl)),
      });
    }, true),
  );

  // A top-level navigation from github.com: no Origin to check. The one-time
  // state, bound to this signed-in owner/admin, is the CSRF protection.
  router.get(GITHUB_MANIFEST_CALLBACK_PATH, async (ctx) => {
    const code = ctx.url.searchParams.get("code") ?? "";
    const state = ctx.url.searchParams.get("state") ?? "";
    const user = await auth.getSessionFromRequest(ctx.request);
    if (!user) return toOffice("signed_out");
    if (!isOfficeManager(user.role)) return toOffice("owner_or_admin_required");
    if (!state || !states.consume(state, user.id)) return toOffice("invalid_state");
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(code)) return toOffice("invalid_code");
    if (connection.managedByEnv) return toOffice("managed_by_env");
    if (!connection.store.canStore) return toOffice("master_key_required");
    try {
      const app = await convertManifest(connection.api, code);
      connection.store.saveApp(app);
      changed();
      audit(user, "connect", { kind: "app", appId: app.appId, slug: app.slug, owner: app.owner });
      logger.info({ appId: app.appId, slug: app.slug }, "github app created from manifest");
      // Next step: install the app on the org and pick its repos.
      if (app.htmlUrl?.startsWith("https://")) {
        return new Response(null, {
          status: 303,
          headers: { location: `${app.htmlUrl}/installations/new`, "cache-control": "no-store" },
        });
      }
      return toOffice("connected");
    } catch (err) {
      connection.describeError(err);
      return toOffice("conversion_failed");
    }
  });

  // GitHub sends `installation_id` here; nothing is trusted from it. The office
  // lists the app's installations itself with the app's own JWT.
  router.get(GITHUB_APP_SETUP_PATH, async (ctx) => {
    const user = await auth.getSessionFromRequest(ctx.request);
    // Only a signed-in owner/admin drops the cached lists, so the new installation shows.
    if (user && isOfficeManager(user.role)) changed();
    return toOffice("installed");
  });
}
