/**
 * Where the seated henchman's body is, relative to the avatar's origin (the
 * group `RobotAvatar` is placed with), in the still seated pose of #159
 * (`SEATED_CLIPS.idle`, the last frame of `Robot_Sitting`), in metres after
 * `MODEL_SCALE`. Measured from robot.glb (#163) and checked against the file
 * by `seatedFit.glb.test.ts`.
 *
 * The seated pose leaves the feet at the origin and puts the hips 0.24 m
 * behind it, so an avatar placed on a seat point sits 0.24 m behind where it
 * was put: that is what drove the henchman's body through the chair's backrest.
 * `seatedOffset` places the hips instead, from the seat's sit anchor
 * (furniture/sitAnchor.ts).
 */

/** The Hips bone: this high above the avatar origin and this far behind it. */
export const SEATED_HIPS = { up: 0.294, back: 0.239 } as const;
/** The underside of the torso and thighs, below the Hips bone. */
export const SEATED_SIT_DROP = 0.015;
/** The back of the torso, behind the Hips bone (the head is not included). */
export const SEATED_BACK_DEPTH = 0.252;
/** The front of the torso and thighs, ahead of the Hips bone (the knees). */
export const SEATED_FRONT_DEPTH = 0.239;
/** The underside of the head, above the Hips bone. The head overhangs the back by 0.22 m. */
export const SEATED_HEAD_BOTTOM = 0.51;
/** Air between the henchman's back and the backrest, so the two never z-fight. */
export const BACK_GAP = 0.02;
/** Air between the henchman's front and the table edge in front of it. */
export const TABLE_GAP = 0.02;

/** A seat's sittable surfaces, relative to its seat point (furniture/sitAnchor.ts). */
export interface SitAnchor {
  /** Height of the seat cushion's top above the floor. */
  seatY: number;
  /** Signed distance along the seat's facing to the backrest's front (negative: behind the seat point). */
  backFwd: number;
}

export interface SeatedOffset {
  /** How far to move the avatar origin along the seat's facing from the seat point. */
  forward: number;
  /** Height of the avatar origin above the floor. */
  lift: number;
}

/** How far ahead of the backrest the seated body reaches (backrest gap, torso and knees). */
export const SEATED_REACH = BACK_GAP + SEATED_BACK_DEPTH + SEATED_FRONT_DEPTH;

/**
 * Where a seated body is relative to its avatar origin, per character model:
 * robot.glb (the constants above; humans) or the henchman (#184,
 * scene/henchmen/seatedFit.ts).
 */
export interface SeatedBody {
  hips: { up: number; back: number };
  sitDrop: number;
  backDepth: number;
}

export const ROBOT_SEATED_BODY: SeatedBody = {
  hips: SEATED_HIPS,
  sitDrop: SEATED_SIT_DROP,
  backDepth: SEATED_BACK_DEPTH,
};

/**
 * Avatar origin for a seated avatar: the underside of the body rests on the
 * cushion and the back sits `BACK_GAP` in front of the backrest.
 */
export function seatedOffset(
  anchor: SitAnchor,
  body: SeatedBody = ROBOT_SEATED_BODY,
): SeatedOffset {
  const hipsY = anchor.seatY + body.sitDrop;
  const hipsFwd = anchor.backFwd + BACK_GAP + body.backDepth;
  return { forward: hipsFwd + body.hips.back, lift: hipsY - body.hips.up };
}
