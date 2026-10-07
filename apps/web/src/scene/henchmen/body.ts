/**
 * The henchman's body (#184, restyled in #281), an original low-poly design
 * built from primitives: a tall, slim, athletic adult about seven heads high,
 * shoulders wider than the hips, long legs in tall boots, in a plain one-piece
 * jumpsuit with a dark belt and gloves. The provider trim is the collar, an
 * armband on each upper arm, the cuffs and a chest badge; the status light is
 * a lamp on each shoulder (statusLight.ts). The head and hair (head.ts,
 * headwear.ts) and outfit layers (outfits.ts) go on top. Model space as in
 * rig.ts: metres, facing +z, the left side at +x.
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
import { lightMounts } from "./statusLight.ts";

export const DOWN: V3 = [0, -1, 0];
export const UP: V3 = [0, 1, 0];

export const at = (bone: BoneName): V3 => bindPosition(bone).toArray() as unknown as V3;
export const blendAt = (to: BoneName, axis: V3, width: number, joint: BoneName = to): Blend => ({
  to,
  at: at(joint),
  axis,
  width,
});

/** Torso profile (half-width, height); the cross-section is `TORSO_DEPTH` as deep as wide. */
export const TORSO_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.001, 0.815],
  [0.085, 0.818],
  [0.14, 0.85],
  [0.153, 0.91],
  [0.146, 0.99],
  [0.15, 1.07],
  [0.168, 1.17],
  [0.192, 1.27],
  [0.2, 1.34],
  [0.172, 1.392],
  [0.1, 1.424],
  [0.05, 1.44],
];
export const TORSO_DEPTH = 0.62;
/** The front of the suit at chest height, where the outfit layers sit. */
export const CHEST_FRONT = 0.192 * TORSO_DEPTH;

/** Jumpsuit details a skin can leave off. */
export interface BodyOptions {
  /** An armband in the provider colour on each upper arm. */
  armbands: boolean;
  /** Knee pads. */
  kneePads: boolean;
  /** The jumpsuit's zip, chest pocket and belt pouch. */
  workwear: boolean;
  /** Low shoes under the trouser legs instead of tall boots. */
  shoes?: boolean;
}

function torso(opts: BodyOptions): Part[] {
  const bands: Blend[] = [
    { to: "Abdomen", at: [0, 1.04, 0], axis: UP, width: 0.1 },
    { to: "Body", at: [0, 1.19, 0], axis: UP, width: 0.12 },
  ];
  return [
    part(lathe(TORSO_PROFILE, TORSO_DEPTH, {}, 14), "suit", "Hips", bands),
    // Square shoulders over the arm joints.
    part(ellipsoid([0.072, 0.06, 0.074], { at: [0.2, 1.378, 0] }, [8, 5]), "suit", "Body"),
    part(ellipsoid([0.072, 0.06, 0.074], { at: [-0.2, 1.378, 0] }, [8, 5]), "suit", "Body"),
    // Stand-up collar in the provider colour.
    part(
      cylinder(0.058, 0.082, 0.052, { at: [0, 1.44, 0.002], scale: [1, 1, 0.9] }, 12),
      "trim",
      "Body",
    ),
    // Provider badge on the chest.
    part(
      cylinder(0.03, 0.03, 0.014, { at: [-0.085, 1.27, 0.1], rot: [Math.PI / 2 - 0.1, 0, 0] }, 10),
      "trim",
      "Body",
    ),
    ...(opts.workwear
      ? [
          // Zip down the front and a chest pocket.
          part(
            box([0.014, 0.33, 0.012], { at: [0, 1.225, CHEST_FRONT - 0.008], rot: [-0.05, 0, 0] }),
            "suitDark",
            "Body",
          ),
          part(
            box([0.07, 0.06, 0.016], { at: [0.085, 1.265, 0.1], rot: [-0.08, 0.3, 0] }),
            "suitDark",
            "Body",
          ),
        ]
      : []),
    // Belt, buckle and a pouch.
    part(
      cylinder(0.152, 0.156, 0.05, { at: [0, 0.985, 0], scale: [1, 1, TORSO_DEPTH + 0.02] }, 14),
      "belt",
      "Hips",
    ),
    part(box([0.05, 0.04, 0.014], { at: [0, 0.985, 0.097] }), "metal", "Hips"),
    ...(opts.workwear
      ? [
          part(
            box([0.05, 0.065, 0.04], { at: [-0.135, 0.955, 0.045], rot: [0, -0.9, 0] }),
            "belt",
            "Hips",
          ),
        ]
      : []),
    ...lightMounts("crew"),
  ];
}

function leg(side: "L" | "R", opts: BodyOptions): Part[] {
  const s = side === "L" ? 1 : -1;
  const x = 0.085 * s;
  const upper = `UpperLeg${side}` as BoneName;
  const lower = `LowerLeg${side}` as BoneName;
  const foot = `Foot${side}` as BoneName;
  return [
    part(capsule([x, 0.86, 0], [x, 0.47, 0], 0.07), "pants", upper, [blendAt(lower, DOWN, 0.1)]),
    part(capsule([x, 0.47, 0], [x, 0.12, 0], 0.056), "pants", lower, [
      { to: upper, at: at(lower), axis: UP, width: 0.1 },
    ]),
    ...(opts.kneePads
      ? [part(ellipsoid([0.042, 0.05, 0.02], { at: [x, 0.475, 0.052] }, [6, 4]), "suitDark", lower)]
      : []),
    // Tall boots (or the trouser leg down to a low shoe), then the foot and toe cap.
    opts.shoes
      ? part(cylinder(0.054, 0.058, 0.1, { at: [x, 0.12, 0] }, 10), "pants", lower)
      : part(cylinder(0.064, 0.06, 0.2, { at: [x, 0.17, 0] }, 10), "boots", lower),
    part(box([0.105, 0.075, 0.22], { at: [x, 0.04, 0.038] }, 0.028), "boots", foot),
    part(ellipsoid([0.052, 0.04, 0.05], { at: [x, 0.042, 0.125] }, [8, 4]), "boots", foot),
  ];
}

function arm(side: "L" | "R", opts: BodyOptions): Part[] {
  const s = side === "L" ? 1 : -1;
  const x = 0.2 * s;
  const upper = `UpperArm${side}` as BoneName;
  const lower = `LowerArm${side}` as BoneName;
  const hand = `Hand${side}` as BoneName;
  return [
    part(capsule([x, 1.37, 0], [x, 1.11, 0], 0.054), "suit", upper, [blendAt(lower, DOWN, 0.09)]),
    part(capsule([x, 1.11, 0], [x, 0.9, 0], 0.046), "suit", lower, [
      { to: upper, at: at(lower), axis: UP, width: 0.09 },
    ]),
    ...(opts.armbands
      ? [part(cylinder(0.061, 0.061, 0.055, { at: [x, 1.25, 0] }, 10), "trim", upper)]
      : []),
    // Cuff in the provider colour.
    part(cylinder(0.052, 0.052, 0.03, { at: [x, 0.925, 0] }, 10), "trim", lower),
    // Glove: gauntlet, palm (the inside of the hand faces the body), fingers and thumb.
    part(cylinder(0.052, 0.045, 0.06, { at: [x, 0.885, 0] }, 10), "gloves", lower),
    part(box([0.046, 0.085, 0.078], { at: [x, 0.815, 0] }, 0.02), "gloves", hand),
    part(
      box([0.04, 0.06, 0.07], { at: [x - 0.004 * s, 0.75, 0.002], rot: [0, 0, 0.1 * s] }, 0.018),
      "gloves",
      hand,
    ),
    part(
      capsule([x - 0.02 * s, 0.825, 0.036], [x - 0.026 * s, 0.78, 0.05], 0.015, 5),
      "gloves",
      hand,
    ),
  ];
}

/** The jumpsuit body from the neck down. */
export function bodyParts(opts: BodyOptions): Part[] {
  return [
    ...torso(opts),
    ...leg("L", opts),
    ...leg("R", opts),
    ...arm("L", opts),
    ...arm("R", opts),
  ];
}
