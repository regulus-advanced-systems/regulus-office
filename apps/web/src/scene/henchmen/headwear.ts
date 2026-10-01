/**
 * Henchman headwear (#184): the standard hard hat with its provider band and
 * the special skins' hats and hair. Each carries the status light's mount on
 * top; `LIGHT_AT` says where the light itself sits (HenchmanAvatar draws it
 * as its own small unlit mesh so its colour can change per status).
 */
import {
  box,
  capsule,
  cylinder,
  dome,
  ellipsoid,
  type Part,
  part,
  torus,
  type V3,
} from "./shapes.ts";

export const HEADWEAR = ["helmet", "tactical", "toque", "slick", "lab"] as const;
export type Headwear = (typeof HEADWEAR)[number];

/** The status light's centre (model space, on the Head bone) per headwear. */
export const LIGHT_AT: Readonly<Record<Headwear, V3>> = {
  helmet: [0, 1.632, -0.005],
  tactical: [0, 1.59, -0.02],
  toque: [0, 1.81, 0],
  slick: [0, 1.575, -0.01],
  lab: [0, 1.59, -0.02],
};
export const LIGHT_RADIUS = 0.04;

/** The light's housing: a short dark socket just under the light. */
function mount(head: Headwear): Part {
  const [x, y, z] = LIGHT_AT[head];
  return part(cylinder(0.046, 0.052, 0.035, { at: [x, y - 0.03, z] }, 10), "hatDark", "Head");
}

/** A band over the crown from ear to ear (headset), with ear cups. */
function headset(): Part[] {
  return [
    part(torus(0.182, 0.012, Math.PI, { at: [0, 1.37, -0.01] }), "hatDark", "Head"),
    part(
      cylinder(0.04, 0.04, 0.03, { at: [0.17, 1.37, 0], rot: [0, 0, Math.PI / 2] }, 10),
      "hatDark",
      "Head",
    ),
    part(
      cylinder(0.04, 0.04, 0.03, { at: [-0.17, 1.37, 0], rot: [0, 0, Math.PI / 2] }, 10),
      "hatDark",
      "Head",
    ),
    part(capsule([-0.165, 1.35, 0.03], [-0.07, 1.3, 0.15], 0.009, 4), "hatDark", "Head"),
  ];
}

/** A strap of radius `r` round the head at height `y`, tipped up by `tilt` at the front, with two lenses. */
function goggles(y: number, r: number, tilt: number): Part[] {
  const fy = y + r * Math.sin(tilt);
  const fz = r * Math.cos(tilt) + 0.012;
  const lens = (s: number) =>
    part(
      cylinder(
        0.04,
        0.044,
        0.035,
        { at: [0.058 * s, fy, fz + 0.01], rot: [Math.PI / 2 - tilt, 0, 0] },
        12,
      ),
      "lens",
      "Head",
    );
  return [
    part(cylinder(r, r, 0.03, { at: [0, y, 0], rot: [-tilt, 0, 0] }, 18, true), "hatDark", "Head"),
    part(box([0.17, 0.05, 0.03], { at: [0, fy, fz], rot: [-tilt, 0, 0] }), "hatDark", "Head"),
    lens(1),
    lens(-1),
  ];
}

const builders: Readonly<Record<Headwear, () => Part[]>> = {
  // A rounded hard hat with a ridge, an all-round brim with a longer peak, and the provider band.
  helmet: () => [
    part(dome([0.176, 0.14, 0.183], { at: [0, 1.455, -0.005] }, 18), "hat", "Head"),
    part(box([0.045, 0.035, 0.31], { at: [0, 1.578, -0.005] }, 0.016), "hat", "Head"),
    part(cylinder(0.2, 0.205, 0.018, { at: [0, 1.457, 0] }, 18), "hat", "Head"),
    part(
      cylinder(0.13, 0.13, 0.018, { at: [0, 1.458, 0.115], scale: [1, 1, 0.8] }, 14),
      "hat",
      "Head",
    ),
    part(cylinder(0.179, 0.182, 0.036, { at: [0, 1.483, -0.005] }, 18, true), "trim", "Head"),
    mount("helmet"),
  ],
  // Black ops: a close tactical helmet, rails and night goggles over the eyes.
  tactical: () => [
    part(dome([0.172, 0.145, 0.18], { at: [0, 1.405, -0.005] }, 18), "hat", "Head"),
    part(cylinder(0.176, 0.18, 0.05, { at: [0, 1.405, -0.005] }, 18, true), "hat", "Head"),
    part(box([0.03, 0.04, 0.16], { at: [0.172, 1.43, -0.01] }), "hatDark", "Head"),
    part(box([0.03, 0.04, 0.16], { at: [-0.172, 1.43, -0.01] }), "hatDark", "Head"),
    ...goggles(1.41, 0.152, 0),
    mount("tactical"),
  ],
  // Chef: a tall pleated toque and a neckerchief knot (the neckerchief is in the outfit).
  toque: () => [
    part(cylinder(0.15, 0.152, 0.12, { at: [0, 1.5, 0] }, 16), "white", "Head"),
    part(cylinder(0.175, 0.15, 0.13, { at: [0, 1.625, 0] }, 16), "white", "Head"),
    part(ellipsoid([0.2, 0.09, 0.2], { at: [0, 1.7, 0] }, [16, 8]), "white", "Head"),
    part(cylinder(0.153, 0.153, 0.03, { at: [0, 1.455, 0] }, 16, true), "trim", "Head"),
    mount("toque"),
  ],
  // The number two: slicked-back hair with a side part and a headset.
  slick: () => [
    part(
      ellipsoid([0.158, 0.1, 0.165], { at: [0, 1.475, -0.03], rot: [-0.25, 0, 0] }, [16, 8]),
      "hair",
      "Head",
    ),
    part(ellipsoid([0.15, 0.1, 0.09], { at: [0, 1.39, -0.09] }, [12, 8]), "hair", "Head"),
    ...headset(),
    mount("slick"),
  ],
  // The lab: unruly hair tufts, goggles pushed up on the forehead and a headset.
  lab: () => [
    part(ellipsoid([0.16, 0.1, 0.16], { at: [0, 1.47, -0.02] }, [14, 8]), "hair", "Head"),
    part(ellipsoid([0.06, 0.05, 0.06], { at: [0.135, 1.45, -0.04] }, [8, 6]), "hair", "Head"),
    part(ellipsoid([0.06, 0.05, 0.06], { at: [-0.135, 1.45, -0.04] }, [8, 6]), "hair", "Head"),
    part(ellipsoid([0.07, 0.06, 0.07], { at: [0, 1.5, -0.1] }, [8, 6]), "hair", "Head"),
    ...goggles(1.47, 0.135, 0.3),
    ...headset(),
    mount("lab"),
  ],
};

export function headwearParts(head: Headwear): Part[] {
  return builders[head]();
}
