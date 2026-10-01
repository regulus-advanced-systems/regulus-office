/**
 * Lair colours (SPEC §12 "Palette"): rock greys and browns, concrete, oiled
 * steel, and the four accents (henchman yellow, alarm red, console teal,
 * brass), with warm tungsten light against cool rock. Every lair piece takes
 * its vertex colours from here, so a decor style can retint the kit in one
 * place. Plain sRGB hex strings; the geometry builder converts them. The
 * accents come from the henchmen's palette so the characters and the rooms
 * use the same yellow, red and brass.
 */
import { STANDARD_PALETTE } from "../henchmen/palette.ts";

export const LAIR = {
  // Rock: cool grey-browns, darker in the cracks, a lighter dusty top.
  rock: "#6F665C",
  rockDark: "#4A443D",
  rockLight: "#8C8274",
  rockCool: "#5E6266",
  /** The section cut on top of a wall (reads as solid mountain). */
  rockCut: "#2E2A26",
  // Poured concrete and its formwork marks.
  concrete: "#A39E94",
  concreteDark: "#7E7A72",
  concreteLight: "#BDB8AD",
  // Steel: oiled gunmetal, painted plate, rivets.
  steel: "#5B636B",
  steelDark: "#3A4046",
  steelLight: "#8A939B",
  steelPaint: "#4F6A6E",
  olive: "#5F6B4E",
  // Accents (SPEC §12), shared with the henchmen's jumpsuit palette (#184).
  yellow: STANDARD_PALETTE.suit,
  red: STANDARD_PALETTE.accent,
  teal: "#2EC4B6",
  brass: STANDARD_PALETTE.metal,
  // Light and glow.
  tungsten: "#FFB65C",
  tungstenGlow: "#FFD9A0",
  black: "#1C1D1F",
  // Retro-futuristic furniture.
  walnut: "#6B4329",
  walnutDark: "#4A2D1C",
  leather: "#8C3B24",
  orange: "#D9692B",
  cream: "#E8DCC0",
  chrome: "#A3ABB2",
  // Life: plants, wood crates, sacking.
  leaf: "#3F7A3A",
  leafDark: "#2C5A2B",
  leafLight: "#6A9E3F",
  soil: "#3B2A1E",
  crate: "#9C7444",
  crateDark: "#6E4F2C",
  canvas: "#A89A72",
  terracotta: "#A65A3A",
} as const;

export type LairColor = keyof typeof LAIR;
