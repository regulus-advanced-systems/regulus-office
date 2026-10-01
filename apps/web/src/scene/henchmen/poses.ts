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
export const STAND_HIPS_Y = 0.62;
export const SEAT_HIPS_Y = 0.43;

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

/** Seated on the cushion: thighs forward, shins down, feet flat, hunched a little to the desk. */
export const SIT: Pose = {
  hipsY: SEAT_HIPS_Y,
  UpperLegL: [-77, 0, 3],
  UpperLegR: [-77, 0, -3],
  LowerLegL: [75, 0, 0],
  LowerLegR: [75, 0, 0],
  FootL: [7, 0, 0],
  FootR: [7, 0, 0],
  Abdomen: [6, 0, 0],
  Body: [5, 0, 0],
};

/** Seated, hands resting on the desk in front of the laptop (the still pose, #159). */
export const SIT_IDLE: Pose = merge(SIT, {
  UpperArmL: [-52, -12, 10],
  UpperArmR: [-52, 12, -10],
  LowerArmL: [-38, 0, 0],
  LowerArmR: [-38, 0, 0],
  HandL: [10, 0, 0],
  HandR: [10, 0, 0],
  Head: [4, 0, 0],
});

/** Seated, hands on the keyboard (the typing loop wiggles the forearms over this). */
export const SIT_TYPE: Pose = merge(SIT_IDLE, {
  UpperArmL: [-58, -14, 9],
  UpperArmR: [-58, 14, -9],
  LowerArmL: [-42, 0, 0],
  LowerArmR: [-42, 0, 0],
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
  UpperArmR: [-38, 22, 14],
  LowerArmR: [-128, 0, 0],
  HandR: [-20, 0, 0],
  UpperArmL: [-18, -48, 6],
  LowerArmL: [-84, 0, 0],
} as const satisfies Pose;

/** The raised hand of a henchman waiting for permission: right arm straight up. */
export const HAND_UP = {
  UpperArmR: [-12, 0, -168],
  LowerArmR: [-18, 0, 0],
  HandR: [0, 0, 0],
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
  UpperArmR: [-62, 30, 22],
  LowerArmR: [-118, 0, 0],
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
