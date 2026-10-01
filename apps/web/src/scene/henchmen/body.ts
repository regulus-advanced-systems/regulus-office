/**
 * The henchman's body (#184), an original low-poly design built from
 * primitives: a chunky barrel torso about five heads tall, short thick legs
 * in work boots, long arms with big gloves, a square stubbled jaw and a
 * scowl. The jumpsuit carries the provider trim on the collar, shoulder
 * straps, cuffs and chest badge. Headwear and outfit layers (skins.ts) go on
 * top. Model space as in rig.ts: metres, facing +z, the left side at +x.
 */
import { type BoneName, bindPosition } from "./rig.ts";
import {
  type Blend,
  box,
  capsule,
  cylinder,
  ellipsoid,
  lathe,
  type Part,
  part,
  type V3,
} from "./shapes.ts";

const DOWN: V3 = [0, -1, 0];
const UP: V3 = [0, 1, 0];

const at = (bone: BoneName): V3 => bindPosition(bone).toArray() as unknown as V3;
const blendAt = (to: BoneName, axis: V3, width: number, joint: BoneName = to): Blend => ({
  to,
  at: at(joint),
  axis,
  width,
});

/** Torso profile (half-width, height); the cross-section is `TORSO_DEPTH` as deep as wide. */
export const TORSO_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.001, 0.5],
  [0.12, 0.505],
  [0.19, 0.55],
  [0.215, 0.62],
  [0.225, 0.72],
  [0.235, 0.82],
  [0.245, 0.92],
  [0.25, 1.02],
  [0.245, 1.1],
  [0.2, 1.17],
  [0.12, 1.21],
  [0.06, 1.225],
];
export const TORSO_DEPTH = 0.74;

/** Jumpsuit details a skin can leave off. */
export interface BodyOptions {
  /** Shoulder straps in the provider colour. */
  straps: boolean;
  /** Knee pads. */
  kneePads: boolean;
}

function torso(opts: BodyOptions): Part[] {
  const bands: Blend[] = [
    { to: "Abdomen", at: [0, 0.72, 0], axis: UP, width: 0.1 },
    { to: "Body", at: [0, 0.88, 0], axis: UP, width: 0.12 },
  ];
  return [
    part(lathe(TORSO_PROFILE, TORSO_DEPTH, {}, 16), "suit", "Hips", bands),
    // Chunky shoulders over the arm joints.
    part(ellipsoid([0.115, 0.1, 0.11], { at: [0.27, 1.1, 0] }), "suit", "Body"),
    part(ellipsoid([0.115, 0.1, 0.11], { at: [-0.27, 1.1, 0] }), "suit", "Body"),
    // Shoulder straps in the provider colour.
    ...(opts.straps
      ? [
          part(
            box([0.13, 0.025, 0.1], { at: [0.25, 1.19, 0], rot: [0, 0, -0.35] }),
            "trim",
            "Body",
          ),
          part(
            box([0.13, 0.025, 0.1], { at: [-0.25, 1.19, 0], rot: [0, 0, 0.35] }),
            "trim",
            "Body",
          ),
        ]
      : []),
    // Turned-down collar.
    part(cylinder(0.085, 0.14, 0.06, { at: [0, 1.2, 0.0] }, 14), "trim", "Body"),
    // Chest pocket (left) and provider badge (right).
    part(box([0.1, 0.09, 0.03], { at: [0.11, 1.0, 0.163], rot: [0, 0.35, 0] }), "suitDark", "Body"),
    part(
      cylinder(
        0.042,
        0.042,
        0.02,
        { at: [-0.11, 1.0, 0.172], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1] },
        12,
      ),
      "trim",
      "Body",
    ),
    // Belt, buckle and a pouch.
    part(
      cylinder(0.232, 0.228, 0.06, { at: [0, 0.69, 0.006], scale: [1, 1, 0.8] }, 18),
      "belt",
      "Hips",
    ),
    part(box([0.075, 0.055, 0.02], { at: [0, 0.69, 0.19] }), "metal", "Hips"),
    part(box([0.08, 0.085, 0.06], { at: [-0.205, 0.65, 0.07], rot: [0, -0.9, 0] }), "belt", "Hips"),
  ];
}

function leg(side: "L" | "R", opts: BodyOptions): Part[] {
  const s = side === "L" ? 1 : -1;
  const x = 0.11 * s;
  const upper = `UpperLeg${side}` as BoneName;
  const lower = `LowerLeg${side}` as BoneName;
  const foot = `Foot${side}` as BoneName;
  return [
    part(capsule([x, 0.6, 0], [x, 0.34, 0], 0.098), "pants", upper, [blendAt(lower, DOWN, 0.1)]),
    part(capsule([x, 0.34, 0], [x, 0.16, 0], 0.085), "pants", lower, [
      { to: upper, at: at(lower), axis: UP, width: 0.1 },
    ]),
    // Knee pad.
    ...(opts.kneePads
      ? [part(ellipsoid([0.055, 0.06, 0.022], { at: [x, 0.345, 0.082] }), "suitDark", lower)]
      : []),
    // Boot: shaft, foot and toe cap.
    part(cylinder(0.088, 0.09, 0.13, { at: [x, 0.16, 0] }, 12), "boots", lower),
    part(box([0.15, 0.09, 0.25], { at: [x, 0.05, 0.04] }, 0.035), "boots", foot),
    part(ellipsoid([0.075, 0.05, 0.06], { at: [x, 0.055, 0.14] }), "boots", foot),
  ];
}

function arm(side: "L" | "R"): Part[] {
  const s = side === "L" ? 1 : -1;
  const x = 0.3 * s;
  const upper = `UpperArm${side}` as BoneName;
  const lower = `LowerArm${side}` as BoneName;
  const hand = `Hand${side}` as BoneName;
  return [
    part(capsule([x, 1.1, 0], [x, 0.84, 0], 0.078), "suit", upper, [blendAt(lower, DOWN, 0.09)]),
    part(capsule([x, 0.84, 0], [x, 0.66, 0], 0.07), "suit", lower, [
      { to: upper, at: at(lower), axis: UP, width: 0.09 },
    ]),
    // Cuff in the provider colour.
    part(cylinder(0.08, 0.08, 0.045, { at: [x, 0.655, 0] }, 12), "trim", lower),
    // Glove: wrist, palm (inside of the hand faces the body), fingers and thumb.
    part(cylinder(0.062, 0.058, 0.05, { at: [x, 0.625, 0] }, 10), "gloves", hand),
    part(box([0.07, 0.11, 0.11], { at: [x, 0.56, 0] }, 0.03), "gloves", hand),
    part(
      box([0.06, 0.075, 0.1], { at: [x - 0.006 * s, 0.48, 0.003], rot: [0, 0, 0.12 * s] }, 0.026),
      "gloves",
      hand,
    ),
    part(capsule([x - 0.03 * s, 0.57, 0.05], [x - 0.04 * s, 0.51, 0.07], 0.022, 6), "gloves", hand),
  ];
}

function head(): Part[] {
  const brow = (s: number) =>
    part(
      box([0.068, 0.018, 0.022], { at: [0.056 * s, 1.448, 0.148], rot: [0, 0, 0.22 * s] }),
      "hair",
      "Head",
    );
  const eye = (s: number) =>
    part(
      ellipsoid([0.019, 0.025, 0.012], { at: [0.055 * s, 1.408, 0.152] }, [8, 6]),
      "ink",
      "Head",
    );
  const ear = (s: number) =>
    part(ellipsoid([0.026, 0.045, 0.034], { at: [0.152 * s, 1.37, 0.0] }, [8, 6]), "skin", "Head");
  return [
    part(cylinder(0.072, 0.078, 0.14, { at: [0, 1.2, 0] }, 10), "skin", "Neck"),
    // Cranium and a wide, square jaw.
    part(ellipsoid([0.148, 0.165, 0.152], { at: [0, 1.375, 0.005] }, [12, 8]), "skin", "Head"),
    part(ellipsoid([0.142, 0.09, 0.138], { at: [0, 1.3, 0.022] }, [12, 6]), "skin", "Head"),
    // Stubble on the chin and a scowl.
    part(ellipsoid([0.13, 0.065, 0.122], { at: [0, 1.282, 0.042] }, [12, 6]), "skinShade", "Head"),
    part(ellipsoid([0.032, 0.038, 0.036], { at: [0, 1.37, 0.162] }, [8, 6]), "skinShade", "Head"),
    part(box([0.06, 0.012, 0.012], { at: [0, 1.315, 0.16] }), "ink", "Head"),
    eye(1),
    eye(-1),
    brow(1),
    brow(-1),
    ear(1),
    ear(-1),
  ];
}

/** Every body part except headwear and outfit layers. */
export function bodyParts(opts: BodyOptions): Part[] {
  return [
    ...torso(opts),
    ...leg("L", opts),
    ...leg("R", opts),
    ...arm("L"),
    ...arm("R"),
    ...head(),
  ];
}
