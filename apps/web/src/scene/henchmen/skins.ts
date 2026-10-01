/**
 * The built-in henchman skins (#184, SPEC §9.3 D22): what each skin id from
 * @regulus/protocol looks like. A skin is a palette (palette.ts), a headwear
 * (headwear.ts), an outfit layer (outfits.ts) and which jumpsuit details it
 * keeps. Geometry is built once per skin and shared by every henchman wearing
 * it; the provider trim only changes the material.
 */
import { type HenchmanSkinId, skinIdFor } from "@regulus/protocol";
import type { BufferGeometry } from "three";
import { type BodyOptions, bodyParts } from "./body.ts";
import { type Headwear, headwearParts, LIGHT_AT } from "./headwear.ts";
import { type Outfit, outfitParts } from "./outfits.ts";
import { HENCHMAN_YELLOW, type Palette, STANDARD_PALETTE } from "./palette.ts";
import { mergeParts, type V3 } from "./shapes.ts";

export interface SkinLook {
  palette: Palette;
  headwear: Headwear;
  outfit: Outfit;
  body: BodyOptions;
}

export const SKIN_LOOKS: Readonly<Record<HenchmanSkinId, SkinLook>> = {
  standard: {
    palette: STANDARD_PALETTE,
    headwear: "helmet",
    outfit: "jumpsuit",
    body: { straps: true, kneePads: true },
  },
  lab_coat: {
    palette: {
      ...STANDARD_PALETTE,
      suit: "#F1F1EC",
      suitDark: "#C9CDD0",
      pants: "#5E6470",
      gloves: "#BFD8E2",
      belt: "#5E6470",
      metal: "#B9BEC4",
      hair: "#D9D6CF",
      hatDark: "#3A3A40",
      lens: "#78C9D9",
    },
    headwear: "lab",
    outfit: "labcoat",
    body: { straps: false, kneePads: false },
  },
  black_ops: {
    palette: {
      ...STANDARD_PALETTE,
      suit: "#2B2E33",
      pants: "#2B2E33",
      suitDark: "#3E434B",
      boots: "#17181B",
      gloves: "#1D1E22",
      belt: "#4B5236",
      metal: "#6B6F76",
      hat: "#24272B",
      hatDark: "#121316",
      lens: "#58E07A",
      hair: "#1B1B1F",
    },
    headwear: "tactical",
    outfit: "vest",
    body: { straps: true, kneePads: true },
  },
  chef: {
    palette: {
      ...STANDARD_PALETTE,
      suit: "#F6F4EE",
      suitDark: "#2B2B30",
      pants: "#54575E",
      white: "#FFFFFF",
      gloves: STANDARD_PALETTE.skin,
      belt: "#F6F4EE",
      metal: "#F6F4EE",
      hatDark: "#3A3A40",
    },
    headwear: "toque",
    outfit: "chef",
    body: { straps: false, kneePads: false },
  },
  number_two: {
    palette: {
      ...STANDARD_PALETTE,
      suit: "#3A3F4B",
      pants: "#3A3F4B",
      suitDark: "#2A2E37",
      shirt: "#F4F1E8",
      boots: "#1A1A1D",
      gloves: STANDARD_PALETTE.skin,
      belt: "#1A1A1D",
      metal: "#C9A227",
      hair: "#2A1F18",
    },
    headwear: "slick",
    outfit: "suit",
    body: { straps: false, kneePads: false },
  },
};

/** The look for a skin id from the wire (unknown ids wear the standard jumpsuit). */
export function skinLook(skin: string | undefined): SkinLook {
  return SKIN_LOOKS[skinIdFor(skin)];
}

/** The palette with the robot's provider colour as trim (falls back to the skin's own). */
export function paletteFor(skin: string | undefined, trim: string | undefined): Palette {
  const look = skinLook(skin);
  return trim ? { ...look.palette, trim } : look.palette;
}

/** Status light centre for a skin, model space. */
export function lightAt(skin: string | undefined): V3 {
  return LIGHT_AT[skinLook(skin).headwear];
}

const geometries = new Map<HenchmanSkinId, BufferGeometry>();

/** The merged, skinned geometry of a skin (cached; callers must not mutate it). */
export function skinGeometry(skin: string | undefined): BufferGeometry {
  const id = skinIdFor(skin);
  let g = geometries.get(id);
  if (!g) {
    const look = SKIN_LOOKS[id];
    g = mergeParts([
      ...bodyParts(look.body),
      ...headwearParts(look.headwear),
      ...outfitParts(look.outfit),
    ]);
    g.name = `henchman:${id}`;
    geometries.set(id, g);
  }
  return g;
}

export { HENCHMAN_YELLOW };
