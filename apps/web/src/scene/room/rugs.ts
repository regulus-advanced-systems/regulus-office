/**
 * Zone rugs (#118): flat rectangles from `template.rugs` that anchor the
 * lounge, meeting nook and kitchen visually. A darker border plane with the
 * rug colour inset on top, both between the floor and the baked blob
 * shadows so furniture on a rug still gets its contact shadow. Patches are
 * flush floor-material zones (wood under a kitchen, a lighter tone under a
 * lounge): one plane just above the floor, under the rugs.
 */
import type { Palette, Rug, RugTone } from "@regulus/room-layout";

/** Heights above the floor: patch, rug border, rug field; all under the blob shadows. */
export const PATCH_Y = 0.001;
export const RUG_BORDER_Y = 0.002;
export const RUG_FIELD_Y = 0.003;
/** Width of the darker border band, metres. */
export const RUG_BORDER = 0.12;
/** How much darker the border is than the field. */
export const RUG_BORDER_SHADE = 0.8;

export interface RugPiece {
  readonly id: string;
  /** Centre of the rug on the ground plane. */
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly color: string;
  readonly borderColor: string;
  readonly style: Rug["style"];
}

/** Warm oak planks for `wood` patches. */
export const WOOD_TONE = "#C98E55";

/** Rug colour for a tone, from the palette (see `RUG_TONES`). */
export function rugColor(tone: RugTone, palette: Palette): string {
  switch (tone) {
    case "alt":
      return palette.floorAlt ?? palette.accent;
    case "light":
      return mix(palette.floor, "#FFFFFF", 0.3);
    case "wood":
      // On a floor that is already wood, go darker so the zone still reads.
      return colorDistance(palette.floor, WOOD_TONE) < 60 ? shade(WOOD_TONE, 0.7) : WOOD_TONE;
    default:
      return palette.wallAlt ?? palette.wall;
  }
}

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff] as const;
};
const toHex = (c: readonly number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** Linear blend of two `#rrggbb` colours in sRGB, `t` = share of `b`. */
export function mix(a: string, b: string, t: number): string {
  const ca = rgb(a);
  const cb = rgb(b);
  return toHex(ca.map((v, i) => v + ((cb[i] as number) - v) * t));
}

export function colorDistance(a: string, b: string): number {
  const ca = rgb(a);
  const cb = rgb(b);
  return Math.hypot(...ca.map((v, i) => v - (cb[i] as number)));
}

function shade(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 0xff) * factor);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

export function rugPieces(rugs: readonly Rug[], palette: Palette): RugPiece[] {
  return rugs.map((r) => {
    const color = rugColor(r.tone, palette);
    return {
      id: r.id,
      x: r.rect.x + r.rect.w / 2,
      z: r.rect.z + r.rect.d / 2,
      width: r.rect.w,
      depth: r.rect.d,
      color,
      borderColor: shade(color, RUG_BORDER_SHADE),
      style: r.style,
    };
  });
}
