/**
 * Laptop size (SPEC §9.4). #143: 1.4x the first cut so the screens read at
 * the default iso zoom; everything that depends on the size (desk inset,
 * screen texture, live panel, bubble origin) derives from here.
 */

/** Scale over the #111 laptop (0.34 x 0.24 m base, 0.31 x 0.19 m screen). */
export const LAPTOP_SCALE = 1.4;

const s = (m: number) => Math.round(m * LAPTOP_SCALE * 1000) / 1000;

export const LAPTOP_DIMENSIONS = {
  w: s(0.34),
  baseH: s(0.018),
  d: s(0.24),
  lidH: s(0.22),
  lidT: s(0.012),
  /** Lid tilt back from vertical, radians. */
  tilt: 0.26,
  screenW: s(0.31),
  screenH: s(0.19),
} as const;

/** Height of the top of the lid above the laptop's base, metres. */
export const LAPTOP_TOP =
  LAPTOP_DIMENSIONS.baseH + LAPTOP_DIMENSIONS.lidH * Math.cos(LAPTOP_DIMENSIONS.tilt);
