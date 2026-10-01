/**
 * Toon shading (SPEC §12; research 03 §8): `MeshToonMaterial` with a 3-4 step
 * gradient ramp, no specular, no outlines. Also converts loaded glTF
 * materials (Kenney's are flat `KHR_materials_unlit` colours) to the same look.
 */
import type { Palette } from "@regulus/room-layout";
import {
  Color,
  DataTexture,
  type Material,
  Mesh,
  MeshToonMaterial,
  NearestFilter,
  type Object3D,
  RedFormat,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
} from "three";

export const TOON_STEPS = 4;
/** Darkest ramp step as a fraction of the base colour; GDT shading is soft and bright. */
export const TOON_DARKEST = 0.55;

/**
 * Red-channel bytes for an N-step ramp from `darkest` to 1, evenly spaced.
 * MeshToonMaterial samples this by N·L with nearest filtering, so each byte
 * is one flat band.
 */
export function gradientRampBytes(steps = TOON_STEPS, darkest = TOON_DARKEST): Uint8Array {
  const n = Math.max(2, Math.floor(steps));
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out[i] = Math.round(255 * (darkest + (1 - darkest) * t));
  }
  return out;
}

export function createGradientMap(steps = TOON_STEPS, darkest = TOON_DARKEST): DataTexture {
  const bytes = gradientRampBytes(steps, darkest);
  const tex = new DataTexture(bytes, bytes.length, 1, RedFormat, UnsignedByteType);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

let sharedGradientMap: DataTexture | null = null;
/** One ramp texture shared by every toon material in the scene. */
export function sharedToonRamp(): DataTexture {
  sharedGradientMap ??= createGradientMap();
  return sharedGradientMap;
}

export interface ToonOptions {
  map?: Texture | null;
  transparent?: boolean;
  opacity?: number;
}

export function createToonMaterial(
  color: string | Color,
  opts: ToonOptions = {},
): MeshToonMaterial {
  const m = new MeshToonMaterial({
    color: new Color(color),
    gradientMap: sharedToonRamp(),
    map: opts.map ?? null,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
  return m;
}

/**
 * Colour overrides by Kenney material name so the CC0 props read as GDT
 * furniture: wood takes the palette accent, the sofa fabric goes turquoise
 * (research 03 §3, "turquoise bean bags"). Anything else keeps its colour.
 */
export function restyleColor(materialName: string, palette: Palette): string | undefined {
  switch (materialName) {
    case "wood":
      return palette.accent;
    case "woodDark":
      return darken(palette.accent, 0.8);
    case "carpet":
      return "#1D8FB0";
    default:
      return undefined;
  }
}

/** Multiply an `#rrggbb` colour's sRGB channels by `factor` (0..1). */
export function darken(hex: string, factor: number): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 0xff) * factor);
  const out = (ch(16) << 16) | (ch(8) << 8) | ch(0);
  return `#${out.toString(16).padStart(6, "0")}`;
}

const converted = new Map<string, MeshToonMaterial>();

/** Toon material matching a loaded material's base colour (cached per source + colour). */
export function toonFromMaterial(source: Material, override?: string): MeshToonMaterial {
  const base =
    "color" in source && source.color instanceof Color ? source.color : new Color("#ffffff");
  const color = override ? new Color(override) : base;
  const key = `${source.uuid}:${color.getHexString()}`;
  let mat = converted.get(key);
  if (!mat) {
    mat = createToonMaterial(color);
    mat.name = source.name;
    if ("map" in source && source.map) {
      mat.map = source.map as Texture;
      mat.map.colorSpace = SRGBColorSpace;
    }
    converted.set(key, mat);
  }
  return mat;
}

/**
 * Replace every mesh material under `root` with a toon equivalent, applying
 * `recolor(name)` overrides. Mutates the subtree (clone the glTF scene first).
 */
export function toonifyObject(
  root: Object3D,
  recolor?: (materialName: string) => string | undefined,
) {
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const swap = (m: Material) => toonFromMaterial(m, recolor?.(m.name));
    obj.material = Array.isArray(obj.material) ? obj.material.map(swap) : swap(obj.material);
  });
}
