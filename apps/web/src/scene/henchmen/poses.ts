/**
 * Key poses of the henchman's clips (#184), authored by hand for the rig in
 * rig.ts: rotations in degrees (XYZ Euler, bone-local; every rest rotation is
 * identity) and the Hips height. Signs for this rig, facing +z:
 * - legs and arms swing forward with negative x; knees and elbows bend with
 *   positive x (knees) / negative x (elbows);
 * - the left arm (+x side) lifts sideways with positive z, the right with negative z;
 * - the head nods down and the spine leans forward with positive x, the head
 *   turns to its left with positive y.
 */
import type { BoneName } from "./rig.ts";

export type Deg3 = readonly [number, number, number];
export type Pose = Readonly<Partial<Record<BoneName, Deg3>>> & { readonly hipsY?: number };

/** Hips height standing (rig.ts) and seated on a desk chair's cushion. */
export const STAND_HIPS_Y = 0.92;
export const SEAT_HIPS_Y = 0.42;

export function merge(...poses: Pose[]): Pose {
  return Object.assign({}, ...poses) as Pose;
}

/** Standing at ease: arms a little away from the belly, elbows soft. */
export const STAND: Pose = {
  UpperArmL: [0, 0, 8],
  UpperArmR: [0, 0, -8],
  LowerArmL: [-8, 0, 0],
  LowerArmR: [-8, 0, 0],
  hipsY: STAND_HIPS_Y,
};

/**
 * Seated on the cushion, hunched a little to the desk. The desk chairs are low
 * for these long legs (#281), so the knees ride a little above the hips and the
 * shins reach forward under the desk, feet flat on the floor.
 */
export const SIT: Pose = {
  hipsY: SEAT_HIPS_Y,
  UpperLegL: [-96, 0, 3],
  UpperLegR: [-96, 0, -3],
  LowerLegL: [68, 0, 0],
  LowerLegR: [68, 0, 0],
  FootL: [28, 0, 0],
  FootR: [28, 0, 0],
  Abdomen: [6, 0, 0],
  Body: [5, 0, 0],
};

/** Seated, hands resting on the desk in front of the laptop (the still pose, #159). */
export const SIT_IDLE: Pose = merge(SIT, {
  UpperArmL: [-70, -12, 12],
  UpperArmR: [-70, 12, -12],
  LowerArmL: [-38, 0, 0],
  LowerArmR: [-38, 0, 0],
  HandL: [10, 0, 0],
  HandR: [10, 0, 0],
  Head: [4, 0, 0],
});

/** Seated, hands on the keyboard (the typing loop wiggles the forearms over this). */
export const SIT_TYPE: Pose = merge(SIT_IDLE, {
  UpperArmL: [-76, -14, 11],
  UpperArmR: [-76, 14, -11],
  LowerArmL: [-40, 0, 0],
  LowerArmR: [-40, 0, 0],
  HandL: [22, 0, 0],
  HandR: [22, 0, 0],
  Head: [12, 0, 0],
});

/** Holding papers up in front (read). */
export const HOLD_PAPERS = {
  UpperArmL: [-28, -22, 14],
  UpperArmR: [-28, 22, -14],
  LowerArmL: [-78, 0, 0],
  LowerArmR: [-78, 0, 0],
  HandL: [-10, 0, 0],
  HandR: [-10, 0, 0],
} as const satisfies Pose;

/** Chin in the right hand, left arm across the belly (think). */
export const CHIN_IN_HAND = {
  UpperArmR: [-45, 61, -9],
  LowerArmR: [-134, 0, 0],
  HandR: [-20, 0, 0],
  UpperArmL: [-11, -57, -20],
  LowerArmL: [-98, 0, 0],
} as const satisfies Pose;

/**
 * The raised hand of a henchman that is done and has something to look at (#235):
 * it sits up and looks up from its laptop, the right arm high and a little out
 * to the side, held. Out to the side so the room camera, which looks down from
 * above, sees the arm clear of the head; looking up so it sees the face.
 */
export const HAND_UP = {
  UpperArmR: [-8, 0, -158],
  LowerArmR: [-4, 0, 0],
  HandR: [0, 0, 0],
  Abdomen: [0, 0, 0],
  Head: [-14, 0, 0],
} as const satisfies Pose;

/**
 * A clipboard cradled in the left arm against the chest (the secretary, #281):
 * the elbow at the side, the forearm up across the front. Blended over every
 * clip, so she walks, stands and types one-handed without putting it down.
 */
export const HOLD_CLIPBOARD = {
  UpperArmL: [-14, -30, 5],
  LowerArmL: [-108, 0, 0],
  HandL: [-10, 0, 0],
} as const satisfies Pose;

/** Both arms forward to carry a box (the walk home, #33). */
export const CARRY = {
  UpperArmL: [-42, -10, 10],
  UpperArmR: [-42, 10, -10],
  LowerArmL: [-48, 0, 0],
  LowerArmR: [-48, 0, 0],
} as const satisfies Pose;

/** Right hand over the eyes (facepalm). */
export const PALM_ON_FACE = {
  UpperArmR: [-73, 38, 18],
  LowerArmR: [-121, 0, 0],
  HandR: [-10, 0, 0],
  Head: [24, 0, 0],
  Body: [6, 0, 0],
} as const satisfies Pose;

/** Right arm pointing straight ahead. */
export const POINTING = {
  UpperArmR: [-86, 0, -4],
  LowerArmR: [-4, 0, 0],
  HandR: [0, 0, 0],
  UpperArmL: [-6, 0, 10],
  Body: [-3, -12, 0],
  Head: [0, -6, 0],
} as const satisfies Pose;

/** Arms up in a V (celebrations). */
export const ARMS_UP = {
  UpperArmL: [-20, 0, 150],
  UpperArmR: [-20, 0, -150],
  LowerArmL: [-25, 0, 0],
  LowerArmR: [-25, 0, 0],
} as const satisfies Pose;

/**
 * "I need you" (#235): a henchman waiting for a permission or an answer sits up,
 * looks up and holds both arms high and wide; the clip waves them. Both arms
 * and no stillness, so it never reads as the one held hand of a done henchman.
 */
export const NEEDS_YOU = {
  UpperArmL: [-14, 0, 142],
  UpperArmR: [-14, 0, -142],
  LowerArmL: [-16, 0, 0],
  LowerArmR: [-16, 0, 0],
  HandL: [0, 0, 0],
  HandR: [0, 0, 0],
  Abdomen: [0, 0, 0],
  Head: [-14, 0, 0],
} as const satisfies Pose;
