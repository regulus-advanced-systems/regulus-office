/**
 * Genius avatars (SPEC §5 `user_profiles.avatar`, §9.3, #185): validate a
 * look against the protocol catalogue and store it on the human's profile.
 * The look is a JSON column; `avatar_chosen_at` marks that the human used the
 * picker, so the first-login picker shows once.
 */
import { checkGeniusLook, type GeniusLookValue } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { AuthHttpError } from "../auth/errors.ts";
import type { Db } from "../db/index.ts";
import { userProfiles } from "../db/schema/index.ts";

/** A validated look, or a 400 naming the offending fields (`invalid_body`, like other routes). */
export function validateAvatar(raw: unknown): GeniusLookValue {
  const check = checkGeniusLook(raw);
  if (!check.ok) throw new AuthHttpError(400, "invalid_body", { fields: check.fields });
  return check.look;
}

/** Save a human's genius and mark it chosen. Throws 404 when the profile is missing. */
export function saveAvatar(db: Db, userId: string, raw: unknown, now: number): GeniusLookValue {
  const look = validateAvatar(raw);
  const updated = db
    .update(userProfiles)
    .set({ avatar: JSON.stringify(look), avatarChosenAt: new Date(now) })
    .where(eq(userProfiles.userId, userId))
    .returning({ userId: userProfiles.userId })
    .all();
  if (updated.length === 0) throw new AuthHttpError(404, "user_not_found");
  return look;
}
