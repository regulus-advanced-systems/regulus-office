/**
 * Zone rugs (#118): flat rectangles from `template.rugs` that anchor the
 * lounge, meeting nook and kitchen visually. A darker border plane with the
 * rug colour inset on top, both between the floor and the baked blob
 * shadows so furniture on a rug still gets its contact shadow.
 */
import type { Palette, Rug, RugTone } from "@regulus/floor-layout";

/** Heights above the floor: border, then field; both under the blob shadows. */
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
}

/** Rug colour for a tone: the palette's second wall colour or its second floor colour. */
export function rugColor(tone: RugTone, palette: Palette): string {
  if (tone === "alt") return palette.floorAlt ?? palette.accent;
  return palette.wallAlt ?? palette.wall;
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
    };
  });
}
