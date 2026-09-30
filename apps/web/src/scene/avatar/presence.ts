/**
 * Map a human's presence (SPEC §6 `HumanPresence`) to an avatar animation and
 * clip. The wire carries the animation enum already; this helper refines it
 * with the seat and the free-text `doing` so a seated human never plays a
 * standing clip and "typing at the whiteboard" reads as typing.
 */
import type { AvatarAnimation, HumanPresence } from "@regulus/protocol";
import { AVATAR_CLIP_NAMES, resolveClip } from "./clips.ts";

export type PresenceLike = Pick<HumanPresence, "animation"> &
  Partial<Pick<HumanPresence, "doing" | "seatId">>;

/** `doing` phrases that override a generic idle/sit animation. */
const DOING_HINTS: ReadonlyArray<readonly [RegExp, AvatarAnimation]> = [
  [/\b(typ|writ|edit|terminal|whiteboard)/i, "sit_type"],
  [/\b(read|watch|review|look)/i, "read"],
  [/\b(think|ponder|wonder)/i, "think"],
];

const GENERIC: ReadonlySet<AvatarAnimation> = new Set(["idle", "sit_idle", "sit_type"]);

/** Animation enum value to play for a presence. */
export function presenceAnimation(presence: PresenceLike): AvatarAnimation {
  const seated = (presence.seatId ?? "") !== "";
  let animation = presence.animation;
  if (seated && (animation === "walk" || animation === "idle")) animation = "sit_idle";
  if (!seated && (animation === "sit_idle" || animation === "sit_type")) animation = "idle";
  if (GENERIC.has(animation)) {
    const doing = presence.doing ?? "";
    for (const [pattern, hinted] of DOING_HINTS) {
      if (!pattern.test(doing)) continue;
      if (hinted === "sit_type" && !seated) break;
      animation = hinted;
      break;
    }
  }
  return animation;
}

/** Clip name (in `available`) to play for a presence. */
export function avatarAnimationFor(
  presence: PresenceLike,
  available: readonly string[] = AVATAR_CLIP_NAMES,
): string {
  return resolveClip(presenceAnimation(presence), available);
}
