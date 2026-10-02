/**
 * REST for media (#48), signed-in humans only:
 *
 *   GET  /api/media         { enabled, canPublish }: whether to show voice and the TV share
 *   POST /api/media/token   { sessionId } → a LiveKit token for the office's media room
 *
 * A token is minted only for a human with a session cookie, from the
 * office's own origin, for one of their own building room sessions (that
 * session id is the LiveKit identity, so other clients map voices and the
 * TV to avatars), with the grants their role allows (protocol media.ts),
 * valid for MEDIA_TOKEN_TTL_SECONDS. 503 `media_not_configured` when
 * LiveKit is not set up. Tokens are never logged or cached.
 */
import {
  MEDIA_STATUS_API_PATH,
  MEDIA_TOKEN_API_PATH,
  MEDIA_TOKEN_TTL_SECONDS,
  type MediaStatus,
  type MediaToken,
  MediaTokenRequest,
  mediaGrantsFor,
} from "@regulus/protocol";
import type { OfficeAuth, SessionUser } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import { readJsonBody } from "../http/body.ts";
import { json, type RouteContext, type Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import type { MediaConfig } from "./config.ts";
import { mintAccessToken } from "./token.ts";

/** A token request is one short id. */
const TOKEN_BODY_MAX_BYTES = 1024;

/** The owner of a building room session, if it is connected. */
export type PresenceLookup = (sessionId: string) => { userId: string } | null;

export interface MediaRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins">;
  config: MediaConfig | null;
  presence: PresenceLookup;
  logger: Logger;
  now?: () => number;
}

const NO_STORE = { "cache-control": "no-store" };

export function mountMediaRoutes(router: Router, deps: MediaRoutesDeps): void {
  const { auth, config, presence, logger } = deps;
  const now = deps.now ?? Date.now;

  const handle =
    (fn: (ctx: RouteContext, user: SessionUser) => Promise<Response> | Response, write = false) =>
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
        throw err;
      }
    };

  router.get(
    MEDIA_STATUS_API_PATH,
    handle((_ctx, user) => {
      const status: MediaStatus = {
        enabled: config !== null,
        canPublish: config !== null && mediaGrantsFor(user.role).canPublish,
      };
      return json(status, { headers: NO_STORE });
    }),
  );

  router.post(
    MEDIA_TOKEN_API_PATH,
    handle(async (ctx, user) => {
      if (!config) throw new AuthHttpError(503, "media_not_configured");
      const body = await readJsonBody(ctx.request, MediaTokenRequest, {
        maxBytes: TOKEN_BODY_MAX_BYTES,
      });
      const owner = presence(body.sessionId);
      if (!owner || owner.userId !== user.id) throw forbidden("not_in_office");
      const grants = mediaGrantsFor(user.role);
      const { token, expiresAt } = mintAccessToken({
        apiKey: config.apiKey,
        apiSecret: config.apiSecret.expose(),
        identity: body.sessionId,
        name: user.displayName,
        room: config.room,
        grants,
        ttlSeconds: MEDIA_TOKEN_TTL_SECONDS,
        now: now(),
      });
      logger.debug(
        { userId: user.id, identity: body.sessionId, canPublish: grants.canPublish },
        "media token minted",
      );
      const out: MediaToken = {
        url: config.url,
        token,
        room: config.room,
        identity: body.sessionId,
        expiresAt,
        grants,
      };
      return json(out, { headers: NO_STORE });
    }, true),
  );
}
