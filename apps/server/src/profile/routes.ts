/**
 * REST for the signed-in human's own genius (#185).
 *
 *   PUT /api/me/avatar   `GeniusLook` body; validated, saved, shown to everyone at once
 *
 * `GET /api/me` (auth/routes.ts) returns the current look and `avatarChosen`.
 * Writes need a same-origin request (CSRF), like every cookie-bearing write.
 */
import { GENIUS_AVATAR_API_PATH, type GeniusLookValue } from "@regulus/protocol";
import type { OfficeAuth } from "../auth/auth.ts";
import { AuthHttpError, forbidden, unauthorized } from "../auth/errors.ts";
import { checkOrigin } from "../auth/origin.ts";
import { json, type Router } from "../http/router.ts";
import { saveAvatar } from "./avatar.ts";

export interface ProfileRoutesDeps {
  auth: Pick<OfficeAuth, "getSessionFromRequest" | "publicUrl" | "allowedOrigins" | "db" | "now">;
  /** Push the new look into live presence (BuildingRoom.setAvatar). */
  onAvatarChanged?: (userId: string, look: GeniusLookValue) => void;
}

/** Largest accepted body; a look is about 150 bytes. */
const MAX_BODY_BYTES = 2048;

export function mountProfileRoutes(router: Router, deps: ProfileRoutesDeps): void {
  const { auth } = deps;
  router.add("PUT", GENIUS_AVATAR_API_PATH, async ({ request }) => {
    try {
      const origin = checkOrigin(request, auth.publicUrl, { allowedOrigins: auth.allowedOrigins });
      if (!origin.ok) throw forbidden("origin_mismatch");
      const user = await auth.getSessionFromRequest(request);
      if (!user) throw unauthorized();
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) throw new AuthHttpError(413, "body_too_large");
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new AuthHttpError(400, "invalid_json");
      }
      const look = saveAvatar(auth.db, user.id, raw, auth.now());
      deps.onAvatarChanged?.(user.id, look);
      return json({ avatar: look, avatarChosen: true });
    } catch (err) {
      if (err instanceof AuthHttpError) return err.toResponse();
      throw err;
    }
  });
}
