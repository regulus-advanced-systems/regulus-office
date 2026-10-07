/**
 * The secretary (#281), a form for office agents: an original low-poly design
 * of an adult woman in 1960s spy-film office dress, on the crew's own rig so
 * every clip plays on her. A fitted jacket with a flared hem over a cream
 * blouse, a neck bow in the provider colour, a straight skirt to above the
 * knee, dark tights and court shoes, glasses, hair up (headwear.ts `updo`),
 * and a clipboard of papers cradled in the left arm (`HOLD_CLIPBOARD`).
 *
 * The skirt is one tube shared by both legs: each side follows its own thigh
 * below the hip, so it swings with a stride and folds forward on a chair.
 */
import type { Vector3 } from "three";
import { at, blendAt, DOWN, UP } from "./body.ts";
import { intoBindSpace } from "./posed.ts";
import { HOLD_CLIPBOARD, STAND } from "./poses.ts";
import type { BoneName } from "./rig.ts";
import {
  type Blend,
  box,
  capsule,
  cylinder,
  ellipsoid,
  lathe,
  type Part,
  part,
  torus,
} from "./shapes.ts";
import { lightMounts } from "./statusLight.ts";

const DEPTH = 0.62;
/** The front of the jacket at chest height. */
const FRONT = 0.094;

const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

/** Skirt weights: the hips at the waistband, below the hip joint mostly the thigh on that side. */
function skirtWeights(v: Vector3): Array<[BoneName, number]> {
  const leg = 0.82 * smooth((0.9 - v.y) / 0.14);
  const left = smooth(v.x / 0.07 + 0.5);
  return [
    ["Hips", 1 - leg],
    ["UpperLegL", leg * left],
    ["UpperLegR", leg * (1 - left)],
  ];
}

function torso(): Part[] {
  const bands: Blend[] = [
    { to: "Abdomen", at: [0, 1.04, 0], axis: UP, width: 0.1 },
    { to: "Body", at: [0, 1.19, 0], axis: UP, width: 0.12 },
  ];
  const profile: Array<[number, number]> = [
    [0.001, 0.83],
    [0.1, 0.835],
    [0.14, 0.88],
    [0.142, 0.94],
    [0.108, 1.03],
    [0.112, 1.1],
    [0.138, 1.2],
    [0.15, 1.27],
    [0.158, 1.34],
    [0.14, 1.39],
    [0.085, 1.422],
    [0.045, 1.44],
  ];
  const button = (y: number) =>
    part(
      ellipsoid([0.011, 0.011, 0.006], { at: [0.012, y, FRONT - 0.016] }, [5, 3]),
      "metal",
      "Body",
    );
  const skirt: Part = {
    geometry: lathe(
      [
        [0.144, 0.66],
        [0.15, 0.76],
        [0.154, 0.88],
        [0.146, 0.955],
      ],
      0.68,
      {},
      14,
    ),
    slot: "suitDark",
    bone: "Hips",
    weigh: skirtWeights,
  };
  return [
    part(lathe(profile, DEPTH, {}, 14), "suit", "Hips", bands),
    // The jacket's flared hem over the skirt's waistband.
    part(
      lathe(
        [
          [0.16, 0.925],
          [0.137, 0.985],
          [0.113, 1.035],
        ],
        0.66,
        {},
        14,
      ),
      "suit",
      "Hips",
    ),
    skirt,
    // Neat, slightly squared jacket shoulders.
    part(ellipsoid([0.052, 0.046, 0.058], { at: [0.178, 1.385, 0] }, [8, 5]), "suit", "Body"),
    part(ellipsoid([0.052, 0.046, 0.058], { at: [-0.178, 1.385, 0] }, [8, 5]), "suit", "Body"),
    // Blouse front, its collar wings, and a neck bow in the provider colour.
    part(
      box([0.06, 0.12, 0.01], { at: [0, 1.35, FRONT - 0.012], rot: [-0.22, 0, 0] }),
      "shirt",
      "Body",
    ),
    part(
      box([0.05, 0.026, 0.012], { at: [0.036, 1.41, 0.07], rot: [-0.3, 0, 0.5] }),
      "shirt",
      "Body",
    ),
    part(
      box([0.05, 0.026, 0.012], { at: [-0.036, 1.41, 0.07], rot: [-0.3, 0, -0.5] }),
      "shirt",
      "Body",
    ),
    part(ellipsoid([0.026, 0.016, 0.012], { at: [0.024, 1.392, 0.082] }, [6, 3]), "trim", "Body"),
    part(ellipsoid([0.026, 0.016, 0.012], { at: [-0.024, 1.392, 0.082] }, [6, 3]), "trim", "Body"),
    button(1.24),
    button(1.17),
    button(1.1),
    // A slim belt in the provider colour at the jacket's waist.
    part(
      cylinder(0.111, 0.111, 0.022, { at: [0, 1.04, 0], scale: [1, 1, DEPTH + 0.03] }, 12, true),
      "trim",
      "Hips",
    ),
    ...lightMounts("secretary"),
  ];
}

function leg(side: "L" | "R"): Part[] {
  const s = side === "L" ? 1 : -1;
  const x = 0.075 * s;
  const upper = `UpperLeg${side}` as BoneName;
  const lower = `LowerLeg${side}` as BoneName;
  const foot = `Foot${side}` as BoneName;
  return [
    part(capsule([x, 0.86, 0], [x, 0.47, 0], 0.056), "pants", upper, [blendAt(lower, DOWN, 0.1)]),
    part(capsule([x, 0.47, 0], [x, 0.09, 0], 0.041), "pants", lower, [
      { to: upper, at: at(lower), axis: UP, width: 0.1 },
    ]),
    // Court shoe: sole and toe, and a low block heel.
    part(box([0.07, 0.045, 0.19], { at: [x, 0.032, 0.05] }, 0.02), "boots", foot),
    part(box([0.04, 0.05, 0.04], { at: [x, 0.025, -0.035] }), "boots", foot),
  ];
}

function arm(side: "L" | "R"): Part[] {
  const s = side === "L" ? 1 : -1;
  const x = 0.2 * s;
  const upper = `UpperArm${side}` as BoneName;
  const lower = `LowerArm${side}` as BoneName;
  const hand = `Hand${side}` as BoneName;
  return [
    part(capsule([x, 1.37, 0], [x, 1.11, 0], 0.041), "suit", upper, [blendAt(lower, DOWN, 0.09)]),
    part(capsule([x, 1.11, 0], [x, 0.9, 0], 0.035), "suit", lower, [
      { to: upper, at: at(lower), axis: UP, width: 0.09 },
    ]),
    // Blouse cuff, then the hand.
    part(cylinder(0.04, 0.04, 0.024, { at: [x, 0.888, 0] }, 8), "shirt", lower),
    part(cylinder(0.03, 0.028, 0.04, { at: [x, 0.862, 0] }, 8), "skin", hand),
    part(box([0.034, 0.075, 0.064], { at: [x, 0.812, 0] }, 0.015), "skin", hand),
    part(
      box([0.03, 0.055, 0.058], { at: [x - 0.003 * s, 0.752, 0.002], rot: [0, 0, 0.1 * s] }, 0.013),
      "skin",
      hand,
    ),
    part(
      capsule([x - 0.014 * s, 0.82, 0.03], [x - 0.02 * s, 0.782, 0.042], 0.011, 5),
      "skin",
      hand,
    ),
  ];
}

/** Round glasses frames with upswept corners, and small earrings. */
export function glasses(): Part[] {
  const y = 1.6;
  const z = 0.094;
  const rim = (s: number) =>
    part(torus(0.021, 0.0042, Math.PI * 2, { at: [0.034 * s, y, z] }, 10), "ink", "Head");
  const corner = (s: number) =>
    part(
      box([0.02, 0.008, 0.008], { at: [0.058 * s, y + 0.016, z - 0.004], rot: [0, 0, 0.5 * s] }),
      "ink",
      "Head",
    );
  const temple = (s: number) =>
    part(
      box([0.006, 0.006, 0.09], { at: [0.074 * s, y + 0.006, z - 0.05], rot: [0, 0.22 * s, 0] }),
      "ink",
      "Head",
    );
  const earring = (s: number) =>
    part(
      ellipsoid([0.008, 0.008, 0.008], { at: [0.09 * s, 1.562, 0.002] }, [5, 3]),
      "metal",
      "Head",
    );
  return [
    rim(1),
    rim(-1),
    part(box([0.022, 0.005, 0.005], { at: [0, y + 0.004, z + 0.002] }), "ink", "Head"),
    corner(1),
    corner(-1),
    temple(1),
    temple(-1),
    earring(1),
    earring(-1),
  ];
}

/**
 * The clipboard, modelled where she holds it (leaning on the left forearm
 * against the chest) and carried by the left forearm.
 */
function clipboard(): Part[] {
  const held = { ...STAND, ...HOLD_CLIPBOARD };
  const tilt = { at: [0.075, 1.2, 0.165], rot: [-0.34, -0.28, 0.08] } as const;
  const layer = (size: [number, number, number], dx: number, dy: number, dz: number, turn = 0) => {
    const g = box(size, { at: [dx, dy, dz], rot: [0, 0, turn] });
    g.rotateZ(tilt.rot[2]).rotateX(tilt.rot[0]).rotateY(tilt.rot[1]);
    g.translate(...tilt.at);
    return intoBindSpace(g, held, "LowerArmL");
  };
  return [
    part(layer([0.19, 0.27, 0.01], 0, 0, 0), "belt", "LowerArmL"),
    part(layer([0.17, 0.235, 0.006], 0.004, -0.008, 0.008, 0.03), "white", "LowerArmL"),
    part(layer([0.17, 0.235, 0.004], -0.004, -0.012, 0.013, -0.04), "shirt", "LowerArmL"),
    part(layer([0.07, 0.026, 0.014], 0, 0.122, 0.012), "metal", "LowerArmL"),
  ];
}

/** The secretary from the neck down, with her glasses and clipboard. */
export function secretaryParts(): Part[] {
  return [
    ...torso(),
    ...leg("L"),
    ...leg("R"),
    ...arm("L"),
    ...arm("R"),
    ...glasses(),
    ...clipboard(),
  ];
}
