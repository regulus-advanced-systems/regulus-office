/**
 * Operation palettes (SPEC §9.1, §12; research 03 §3). Colours are approximate
 * hex values from the research notes, not extracted assets. Exported in the
 * order operations cycle through them so consecutive operations look distinct.
 */
import { type Palette, PaletteSchema } from "./types.ts";

export const PALETTES: readonly Palette[] = [
  {
    id: "teal-cream",
    name: "Teal carpet, cream walls",
    floor: "#30B090",
    floorAlt: "#50B090",
    wall: "#F0E0B0",
    wallAlt: "#F0D0B0",
    accent: "#C07020",
    exterior: "#D8B470",
    cap: "#55565A",
  },
  {
    id: "oak-sky",
    name: "Oak floor, sky-blue and orange walls",
    floor: "#D09050",
    floorAlt: "#F0B070",
    wall: "#3FA3E0",
    wallAlt: "#F08030",
    accent: "#B03030",
    exterior: "#903030",
    cap: "#55565A",
  },
  {
    id: "lime-mustard",
    name: "Lime, mustard and orange zones, crimson walls",
    floor: "#7FBF3F",
    floorAlt: "#D9A03A",
    wall: "#C0393B",
    accent: "#E8803A",
    exterior: "#903030",
    cap: "#55565A",
  },
].map((p) => PaletteSchema.parse(p));

/** The lobby always uses the first palette. */
export const LOBBY_PALETTE_ID = "teal-cream";

/** Palette for the n-th project operation (0-based), cycling through `PALETTES`. */
export function paletteForOperation(operationIndex: number): Palette {
  const n = PALETTES.length;
  const i = ((Math.trunc(operationIndex) % n) + n) % n;
  const palette = PALETTES[i];
  if (!palette) throw new Error("PALETTES is empty");
  return palette;
}

export function paletteById(id: string): Palette | undefined {
  return PALETTES.find((p) => p.id === id);
}
