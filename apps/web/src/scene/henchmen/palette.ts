/**
 * Henchman colours (#184). The whole body is one skinned mesh with one toon
 * material per skin and trim colour: every vertex's uv points at a slot of a
 * one-row palette texture, so a henchman is a single draw call (plus its status
 * light) and the 20 in an operation share a handful of materials. A skin (skins.ts)
 * fills the slots; the provider's trim colour fills `trim`.
 */
import {
  Color,
  DataTexture,
  MeshToonMaterial,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
} from "three";
import { getGradientMap, normalizeHex } from "../avatar/toonMaterial.ts";

export const SLOTS = [
  "suit",
  "pants",
  "shirt",
  "suitDark",
  "trim",
  "skin",
  "skinShade",
  "boots",
  "gloves",
  "belt",
  "metal",
  "ink",
  "white",
  "hat",
  "hatDark",
  "hair",
  "accent",
  "lens",
] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_COUNT = SLOTS.length;

export type Palette = Readonly<Record<Slot, string>>;

/** The u coordinate (texel centre) of a slot. */
export function slotU(slot: Slot): number {
  return (SLOTS.indexOf(slot) + 0.5) / SLOT_COUNT;
}

/** Henchman yellow (SPEC §12) and the standard jumpsuit around it. */
export const HENCHMAN_YELLOW = "#F2C200";

export const STANDARD_PALETTE: Palette = {
  suit: HENCHMAN_YELLOW,
  pants: HENCHMAN_YELLOW,
  shirt: "#F4F1E8",
  suitDark: "#C79A0A",
  trim: "#D97757",
  skin: "#E9B48C",
  skinShade: "#C98C66",
  boots: "#2A2A2F",
  gloves: "#33333A",
  belt: "#5B3F2A",
  metal: "#C9A227",
  ink: "#1B1B1F",
  white: "#F4F1E8",
  hat: HENCHMAN_YELLOW,
  hatDark: "#3A3A40",
  hair: "#4A3424",
  accent: "#D7263D",
  lens: "#7FD6E0",
};

function paletteTexture(palette: Palette): DataTexture {
  const data = new Uint8Array(SLOT_COUNT * 4);
  SLOTS.forEach((slot, i) => {
    // sRGB bytes (getHex converts out of the linear working space); three decodes them (colorSpace).
    const hex = new Color(palette[slot]).getHex();
    data.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255], i * 4);
  });
  const texture = new DataTexture(data, SLOT_COUNT, 1, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const cache = new Map<string, MeshToonMaterial>();

/** The palette colours as one cache key. */
export function paletteKey(palette: Palette): string {
  return SLOTS.map((slot) => normalizeHex(palette[slot])).join("");
}

/** Cached toon material for a palette. Callers must not mutate the result. */
export function henchmanMaterial(palette: Palette): MeshToonMaterial {
  const key = paletteKey(palette);
  let material = cache.get(key);
  if (!material) {
    material = new MeshToonMaterial({
      map: paletteTexture(palette),
      gradientMap: getGradientMap(),
    });
    material.name = `henchman:${key}`;
    cache.set(key, material);
  }
  return material;
}

/** Cached henchman materials, for tests and the showcase overlay. */
export function henchmanMaterialCount(): number {
  return cache.size;
}
