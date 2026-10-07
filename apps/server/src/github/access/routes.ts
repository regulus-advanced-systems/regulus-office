/**
 * REST for a person's own GitHub link (SPEC D27; #267). Every signed-in
 * person, for themselves only; nothing here takes a user id, and no response
 * carries a token.
 *
 *   GET    /api/github/link           the viewer's link and what it can see
 *   POST   /api/github/link/start     where to authorise on github.com (one-time state)
 *   GET    /api/github/link/callback  GitHub → office: code + state
 *   POST   /api/github/link/check     check now
 *   DELETE /api/github/link           unlink
 *
 * State changes need a same-origin request. The callback accepts the state
 * once, only for the signed-in person it was issued to (CSRF: nobody can
 * make someone else's office account link an account of their choosing).
 */
import {
  GITHUB_LINK_API_PATH,
  GITHUB_LINK_CALLBACK_PATH,
  GITHUB_LINK_CHECK_API_PATH,
  GITHUB_LINK_RESULT_PARAM,
  GITHUB_LINK_START_API_PATH,
  type StartGitHubLinkResponse,
} from "@regulus/protocol";
import { AUDIT_ACTIONS, writeAudit } from "../../auth/audit.ts";
import type { OfficeAuth, SessionUser } from "../../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../../auth/errors.ts";
import { checkOrigin } from "../../auth/origin.ts";
import type { Db } from "../../db/index.ts";
import { json, type RouteContext, type Router } from "../../http/router.ts";
import type { Logger } from "../../logging.ts";
import type { ManifestStates } from "../manifest.ts";
import { type GitHubAccessService, LinkError } from "./service.ts";

/** A person may ask for "check now" this often. */
export const CHECK_MIN_INTERVAL_MS = 5_000;

export interface GitHubLinkRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  db: Db;
  service: GitHubAccessService;
  /** One-time states for the OAuth callback, bound to the person who started. */
  states: ManifestStates;
  logger: Logger;
  now?: () => number;
}

export function mountGitHubLinkRoutes(router: Router, deps: GitHubLinkRoutesDeps): void {
  const { auth, db, service, states, logger } = deps;
  const now = deps.now ?? Date.now;
  const publicBase = auth.publicUrl.replace(/\/+$/, "");
  const redirectUri = `${publicBase}${GITHUB_LINK_CALLBACK_PATH}`;
  const lastCheck = new Map<string, number>();

  const handle =
    (fn: (ctx: RouteContext, user: SessionUser) => Promise<Response>, write = false) =>
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
        return await fn(ctx, user);
      } catch (err) {
        if (err instanceof AuthHttpError) return err.toResponse();
        if (err instanceof LinkError) {
          const status = err.code === "github_unavailable" ? 502 : 400;
          return json({ error: err.code }, { status });
        }
        throw err;
      }
    };
  const noStore = { headers: { "cache-control": "no-store" } };
  const toOffice = (result: string) =>
    new Response(null, {
      status: 303,
      headers: {
        location: `${publicBase}/office?${GITHUB_LINK_RESULT_PARAM}=${encodeURIComponent(result)}`,
        "cache-control": "no-store",
      },
    });

  router.get(
    GITHUB_LINK_API_PATH,
    handle(async (_ctx, user) => json(service.status(user.id), noStore)),
  );

  router.post(
    GITHUB_LINK_START_API_PATH,
    handle(async (_ctx, user) => {
      const url = service.authorizeUrl(states.issue(user.id), redirectUri);
      return json({ url } satisfies StartGitHubLinkResponse, noStore);
    }, true),
  );

  router.get(GITHUB_LINK_CALLBACK_PATH, async ({ request, url }) => {
    const user = await auth.getSessionFromRequest(request);
    if (!user) return toOffice("signed_out");
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    // The state is spent whatever happens next, also when the person pressed Cancel on GitHub.
    if (!state || !states.consume(state, user.id)) return toOffice("invalid_state");
    if (!code)
      return toOffice(url.searchParams.get("error") === "access_denied" ? "denied" : "no_code");
    try {
      await service.completeLink(user.id, code, redirectUri);
    } catch (err) {
      if (err instanceof LinkError) {
        logger.warn({ userId: user.id, code: err.code, detail: err.detail }, "github link failed");
        return toOffice(err.code);
      }
      logger.error({ userId: user.id, err }, "github link failed");
      return toOffice("failed");
    }
    const linked = service.status(user.id);
    writeAudit(db, {
      userId: user.id,
      action: AUDIT_ACTIONS.githubLink,
      targetKind: "github_link",
      targetId: user.id,
      meta: { login: linked.login },
    });
    return toOffice("linked");
  });

  router.post(
    GITHUB_LINK_CHECK_API_PATH,
    handle(async (_ctx, user) => {
      const last = lastCheck.get(user.id) ?? 0;
      if (now() - last < CHECK_MIN_INTERVAL_MS) {
        return json(
          { error: "too_many_requests" },
          { status: 429, headers: { "retry-after": "5" } },
        );
      }
      lastCheck.set(user.id, now());
      await service.refreshUser(user.id);
      return json(service.status(user.id), noStore);
    }, true),
  );

  router.add(
    "DELETE",
    GITHUB_LINK_API_PATH,
    handle(async (_ctx, user) => {
      if (await service.unlink(user.id)) {
        writeAudit(db, {
          userId: user.id,
          action: AUDIT_ACTIONS.githubUnlink,
          targetKind: "github_link",
          targetId: user.id,
        });
      }
      return json(service.status(user.id), noStore);
    }, true),
  );
}
