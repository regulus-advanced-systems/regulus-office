/**
 * What the special skins wear on the head (#184, restyled in #281). The
 * standard crew is bare-headed with one of the hair styles in head.ts; a
 * special skin has its own hair and, only where it says what the wearer does,
 * something close-fitting: the lab's goggles pushed up on the forehead, the
 * black-ops watch cap, the cook's low cap. No domes, no tall hats.
 */
import { hairCap } from "./head.ts";
import { box, capsule, cylinder, dome, ellipsoid, type Part, part } from "./shapes.ts";

export const HEADWEAR = ["lab", "watchcap", "chefcap", "slick", "updo"] as const;
export type Headwear = (typeof HEADWEAR)[number];

/** A strap of radius `r` round the head at height `y`, tipped up by `tilt` at the front, with two lenses. */
function goggles(y: number, r: number, tilt: number): Part[] {
  const fy = y + r * Math.sin(tilt);
  const fz = r * Math.cos(tilt) + 0.004;
  const lens = (s: number) =>
    part(
      cylinder(
        0.022,
        0.025,
        0.022,
        { at: [0.032 * s, fy, fz + 0.008], rot: [Math.PI / 2 - tilt, 0, 0] },
        8,
      ),
      "lens",
      "Head",
    );
  return [
    part(cylinder(r, r, 0.018, { at: [0, y, 0], rot: [-tilt, 0, 0] }, 12, true), "hatDark", "Head"),
    part(box([0.1, 0.03, 0.02], { at: [0, fy, fz], rot: [-tilt, 0, 0] }), "hatDark", "Head"),
    lens(1),
    lens(-1),
  ];
}

/** A slim boom microphone from the left ear. */
function mic(): Part[] {
  return [
    part(ellipsoid([0.012, 0.022, 0.022], { at: [-0.094, 1.59, 0.0] }, [6, 4]), "hatDark", "Head"),
    part(capsule([-0.094, 1.578, 0.012], [-0.045, 1.542, 0.088], 0.005, 4), "hatDark", "Head"),
  ];
}

const builders: Readonly<Record<Headwear, () => Part[]>> = {
  // The lab: thinning hair with unruly tufts over the ears and safety goggles pushed up.
  lab: () => [
    part(ellipsoid([0.092, 0.05, 0.072], { at: [0, 1.61, -0.04] }, [10, 5]), "hair", "Head"),
    part(ellipsoid([0.034, 0.03, 0.036], { at: [0.088, 1.635, -0.02] }, [6, 4]), "hair", "Head"),
    part(ellipsoid([0.034, 0.03, 0.036], { at: [-0.088, 1.635, -0.02] }, [6, 4]), "hair", "Head"),
    part(ellipsoid([0.05, 0.022, 0.05], { at: [0, 1.712, -0.01] }, [8, 4]), "hair", "Head"),
    ...goggles(1.66, 0.086, 0.32),
  ],
  // Black ops: a close knit watch cap with a rolled brim, and a boom microphone.
  watchcap: () => [
    part(dome([0.094, 0.082, 0.104], { at: [0, 1.642, -0.004] }, 12), "hat", "Head"),
    part(
      cylinder(0.097, 0.097, 0.034, { at: [0, 1.652, -0.004], scale: [1, 1, 1.1] }, 12, true),
      "hatDark",
      "Head",
    ),
    part(ellipsoid([0.086, 0.06, 0.06], { at: [0, 1.595, -0.048] }, [8, 5]), "hair", "Head"),
    ...mic(),
  ],
  // The cook: a low, flat-topped cap with a band in the provider colour.
  chefcap: () => [
    part(ellipsoid([0.086, 0.06, 0.06], { at: [0, 1.6, -0.048] }, [8, 5]), "hair", "Head"),
    part(
      cylinder(0.09, 0.088, 0.05, { at: [0, 1.678, -0.004], scale: [1, 1, 1.1] }, 12),
      "white",
      "Head",
    ),
    part(ellipsoid([0.1, 0.03, 0.108], { at: [0, 1.712, -0.004] }, [12, 4]), "white", "Head"),
    part(
      cylinder(0.092, 0.092, 0.016, { at: [0, 1.662, -0.004], scale: [1, 1, 1.1] }, 12, true),
      "trim",
      "Head",
    ),
  ],
  // The number two: hair slicked straight back.
  slick: () => [
    ...hairCap(0.004),
    part(
      ellipsoid([0.08, 0.03, 0.09], { at: [0, 1.705, -0.03], rot: [-0.22, 0, 0] }, [8, 4]),
      "hair",
      "Head",
    ),
  ],
  // The secretary: hair swept up into a high bun, a side fringe.
  updo: () => [
    ...hairCap(0.008),
    part(ellipsoid([0.058, 0.052, 0.058], { at: [0, 1.742, -0.04] }, [8, 6]), "hair", "Head"),
    part(
      ellipsoid([0.06, 0.024, 0.04], { at: [-0.024, 1.698, 0.062], rot: [0.5, 0, 0.3] }, [8, 4]),
      "hair",
      "Head",
    ),
  ],
};

export function headwearParts(head: Headwear): Part[] {
  return builders[head]();
}
