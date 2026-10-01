/**
 * Colour for geniuses without a material per colour: every vertex carries a
 * palette slot (as a UV into a 16x1 texture) and a look is one tiny palette
 * texture. One body geometry per archetype + accessory serves every colour
 * choice, and one genius is one draw call (SPEC §11).
 */
import {
  GENIUS_HAIRS,
  GENIUS_OUTFITS,
  GENIUS_SKINS,
  GENIUS_TRIMS,
  type GeniusLookValue,
} from "@regulus/protocol";
import {
  Color,
  DataTexture,
  MeshToonMaterial,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
} from "three";
import { getGradientMap } from "../avatar/toonMaterial.ts";

/** Palette slots; geometry stores the slot, the look fills in the colour. */
export const SLOT = {
  outfit: 0,
  /** Darker outfit: trousers, folds, the lining of a cape. */
  outfitDark: 1,
  trim: 2,
  skin: 3,
  /** Shaded skin: nose, ears, lips. */
  skinShade: 4,
  hair: 5,
  /** Shoes, belts, headphones. */
  black: 6,
  eyeWhite: 7,
  pupil: 8,
  mouth: 9,
  silver: 10,
  gold: 11,
  /** Lenses, visor glow. */
  glow: 12,
  /** Bubbling flask. */
  potion: 13,
  pearl: 14,
  lipstick: 15,
} as const;
export type Slot = (typeof SLOT)[keyof typeof SLOT];
export const SLOT_COUNT = 16;

/** UV x of a slot's texel centre. */
export const slotU = (slot: Slot): number => (slot + 0.5) / SLOT_COUNT;

const shade = (hex: string, factor: number): Color => {
  const c = new Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * factor)));
};

/** sRGB colours of every slot for a look. */
export function paletteColors(look: GeniusLookValue): Color[] {
  const outfit = GENIUS_OUTFITS[look.outfit];
  const skin = GENIUS_SKINS[look.skin];
  const colors: Record<Slot, Color> = {
    [SLOT.outfit]: new Color(outfit),
    [SLOT.outfitDark]: shade(outfit, 0.62),
    [SLOT.trim]: new Color(GENIUS_TRIMS[look.trim]),
    [SLOT.skin]: new Color(skin),
    [SLOT.skinShade]: shade(skin, 0.86),
    [SLOT.hair]: new Color(GENIUS_HAIRS[look.hair]),
    [SLOT.black]: new Color("#23211F"),
    [SLOT.eyeWhite]: new Color("#F7F4EC"),
    [SLOT.pupil]: new Color("#16161A"),
    [SLOT.mouth]: new Color("#5A2626"),
    [SLOT.silver]: new Color("#C3C8CF"),
    [SLOT.gold]: new Color("#D9AE3B"),
    [SLOT.glow]: new Color("#6FF3E6"),
    [SLOT.potion]: new Color("#8CF04B"),
    [SLOT.pearl]: new Color("#FBF7EE"),
    [SLOT.lipstick]: new Color("#B3122E"),
  };
  return Array.from({ length: SLOT_COUNT }, (_, i) => colors[i as Slot]);
}

function paletteTexture(look: GeniusLookValue): DataTexture {
  const data = new Uint8Array(SLOT_COUNT * 4);
  paletteColors(look).forEach((c, i) => {
    // getHex() is sRGB; the texture is tagged sRGB so the shader linearises it.
    const hex = c.getHex(SRGBColorSpace);
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

const materials = new Map<string, MeshToonMaterial>();

/**
 * Cached toon material for a look's colours (SPEC §12: toon ramp, no specular; the
 * geometry carries flat per-face normals for the faceted look). A material is a 16-texel texture, so the cache is not pruned.
 */
export function geniusMaterial(look: GeniusLookValue): MeshToonMaterial {
  const key = [look.outfit, look.trim, look.skin, look.hair].join("/");
  let material = materials.get(key);
  if (!material) {
    material = new MeshToonMaterial({
      map: paletteTexture(look),
      gradientMap: getGradientMap(),
    });
    material.name = `genius:${key}`;
    materials.set(key, material);
  }
  return material;
}
