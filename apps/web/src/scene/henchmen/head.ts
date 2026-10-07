/**
 * The crew's head (#281): a small head on a slim neck, about a seventh of the
 * height, with a plain face, and the bare-headed hair styles that make the
 * standard crew different people (variety.ts). The hair is a shell a little
 * larger than the skull, set back and up, so the hairline is where the two
 * surfaces cross. Special skins dress the same head in headwear.ts.
 */
import { box, capsule, cylinder, ellipsoid, type Part, part } from "./shapes.ts";
import type { HairStyle } from "./variety.ts";

/** Centre and radii of the skull, model space. */
export const SKULL_AT = [0, 1.6, 0] as const;
export const SKULL = [0.088, 0.115, 0.098] as const;
/** The top of the bare skull, metres. */
export const CROWN_Y = SKULL_AT[1] + SKULL[1];

export interface FaceOptions {
  /** Coloured lips instead of the plain mouth line. */
  lips?: boolean;
  /** A slimmer jaw and neck. */
  fine?: boolean;
}

export function headParts(face: FaceOptions = {}): Part[] {
  const eye = (s: number) =>
    part(ellipsoid([0.012, 0.016, 0.008], { at: [0.034 * s, 1.6, 0.088] }, [6, 4]), "ink", "Head");
  const brow = (s: number) =>
    part(
      box([0.036, 0.009, 0.012], { at: [0.035 * s, 1.628, 0.089], rot: [0, 0, 0.12 * s] }),
      "hair",
      "Head",
    );
  const ear = (s: number) =>
    part(ellipsoid([0.014, 0.026, 0.02], { at: [0.088 * s, 1.59, 0.0] }, [6, 4]), "skin", "Head");
  const jaw = face.fine ? 0.066 : 0.074;
  return [
    part(
      cylinder(face.fine ? 0.036 : 0.044, face.fine ? 0.04 : 0.05, 0.11, { at: [0, 1.46, 0] }, 8),
      "skin",
      "Neck",
    ),
    part(ellipsoid(SKULL, { at: SKULL_AT }, [12, 8]), "skin", "Head"),
    part(ellipsoid([jaw, 0.062, 0.08], { at: [0, 1.527, 0.012] }, [10, 6]), "skin", "Head"),
    part(ellipsoid([0.014, 0.02, 0.016], { at: [0, 1.572, 0.097] }, [6, 4]), "skinShade", "Head"),
    face.lips
      ? part(ellipsoid([0.019, 0.008, 0.008], { at: [0, 1.536, 0.087] }, [6, 4]), "accent", "Head")
      : part(box([0.034, 0.007, 0.008], { at: [0, 1.536, 0.088] }), "ink", "Head"),
    eye(1),
    eye(-1),
    brow(1),
    brow(-1),
    ear(1),
    ear(-1),
  ];
}

/** Hair over the crown and down the back of the head, `lift` metres proud of the skull. */
export function hairCap(lift: number, back = 0.012): Part[] {
  return [
    part(
      ellipsoid([0.09 + lift, 0.07 + lift, 0.1 + lift], { at: [0, 1.655, -back] }, [12, 6]),
      "hair",
      "Head",
    ),
    part(
      ellipsoid([0.086 + lift, 0.075, 0.06 + lift], { at: [0, 1.6, -0.048] }, [10, 6]),
      "hair",
      "Head",
    ),
  ];
}

const styles: Readonly<Record<HairStyle, () => Part[]>> = {
  // Short all over.
  crop: () => hairCap(0.006),
  // Clipped close to the skull.
  buzz: () => hairCap(0.0015, 0.008),
  // A side parting with a swept fringe.
  part: () => [
    ...hairCap(0.007),
    part(
      ellipsoid([0.062, 0.026, 0.045], { at: [0.022, 1.7, 0.058], rot: [0.5, 0, -0.28] }, [8, 5]),
      "hair",
      "Head",
    ),
  ],
  // Clipped sides and a flat, squared top.
  flattop: () => [
    ...hairCap(0.0015, 0.008),
    part(box([0.15, 0.04, 0.165], { at: [0, 1.703, -0.006] }, 0.016), "hair", "Head"),
  ],
  // Tied back in a short ponytail.
  ponytail: () => [
    ...hairCap(0.005),
    part(ellipsoid([0.03, 0.03, 0.03], { at: [0, 1.665, -0.112] }, [6, 4]), "hair", "Head"),
    part(capsule([0, 1.65, -0.13], [0, 1.555, -0.125], 0.022, 6), "hair", "Head"),
  ],
  // A bare crown, hair round the back and sides, and a moustache.
  balding: () => [
    part(ellipsoid([0.092, 0.05, 0.07], { at: [0, 1.605, -0.042] }, [10, 5]), "hair", "Head"),
    part(box([0.046, 0.012, 0.012], { at: [0, 1.551, 0.092] }), "hair", "Head"),
  ],
};

export function hairParts(style: HairStyle): Part[] {
  return styles[style]();
}
