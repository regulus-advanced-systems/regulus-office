import { describe, expect, test } from "bun:test";
import { officeL2Template, PALETTES, type Palette } from "@regulus/room-layout";
import { BLOB_Y } from "../shadows/blob.ts";
import {
  colorDistance,
  mix,
  PATCH_Y,
  RUG_BORDER_Y,
  RUG_FIELD_Y,
  rugColor,
  rugPieces,
  WOOD_TONE,
} from "./rugs.ts";

const palette = PALETTES[0] as Palette;

describe("rugs", () => {
  test("pieces follow the template rugs, centred on their rects", () => {
    const pieces = rugPieces(officeL2Template.rugs, palette);
    expect(pieces).toHaveLength(officeL2Template.rugs.length);
    const [first] = officeL2Template.rugs;
    const piece = pieces[0];
    if (!first || !piece) throw new Error("office L2 has no rugs");
    expect(piece.x).toBeCloseTo(first.rect.x + first.rect.w / 2, 9);
    expect(piece.z).toBeCloseTo(first.rect.z + first.rect.d / 2, 9);
    expect([piece.width, piece.depth]).toEqual([first.rect.w, first.rect.d]);
    expect(piece.borderColor).not.toBe(piece.color);
  });

  test("tones resolve against the palette, with fallbacks", () => {
    expect(rugColor("warm", palette)).toBe(palette.wallAlt as string);
    expect(rugColor("alt", palette)).toBe(palette.floorAlt as string);
    const plain: Palette = { ...palette, wallAlt: undefined, floorAlt: undefined };
    expect(rugColor("warm", plain)).toBe(plain.wall);
    expect(rugColor("alt", plain)).toBe(plain.accent);
  });

  test("light and wood tones: a lighter floor, and wood that still reads on a wood floor", () => {
    expect(rugColor("light", palette)).toBe(mix(palette.floor, "#FFFFFF", 0.3));
    expect(rugColor("wood", palette)).toBe(WOOD_TONE);
    const oak = PALETTES.find((p) => p.id === "oak-sky") as Palette;
    expect(colorDistance(rugColor("wood", oak), oak.floor)).toBeGreaterThan(
      colorDistance(WOOD_TONE, oak.floor),
    );
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });

  test("patches keep their style and lie flush, under the rugs", () => {
    const pieces = rugPieces(officeL2Template.rugs, palette);
    expect(pieces.some((p) => p.style === "patch")).toBe(true);
    expect(PATCH_Y).toBeGreaterThan(0);
    expect(PATCH_Y).toBeLessThan(RUG_BORDER_Y);
  });

  test("rugs lie above the floor and below the contact shadows", () => {
    expect(RUG_BORDER_Y).toBeGreaterThan(0);
    expect(RUG_FIELD_Y).toBeGreaterThan(RUG_BORDER_Y);
    expect(RUG_FIELD_Y).toBeLessThan(BLOB_Y);
  });
});
