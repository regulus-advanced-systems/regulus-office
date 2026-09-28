/**
 * Toon shading for avatars (SPEC §12: MeshToonMaterial with a 3-4 step ramp,
 * no specular). Materials are cached per colour so the 20 robots on a floor
 * share programs and material objects whenever they share a colour.
 */
import {
  Color,
  DataTexture,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RGBAFormat,
} from "three";

export const TOON_STEPS = 4;

/** Luminance of each ramp step, dark to bright, spread so the darkest step is a shadow, not black. */
export function toonRampValues(steps: number = TOON_STEPS): number[] {
  const values: number[] = [];
  for (let i = 0; i < steps; i++) values.push(Math.round(255 * (0.45 + (0.55 * i) / (steps - 1))));
  return values;
}

let gradientMap: DataTexture | undefined;

/** Shared 1D gradient texture; NearestFilter keeps the steps hard. */
export function getGradientMap(): DataTexture {
  if (gradientMap) return gradientMap;
  const values = toonRampValues();
  const data = new Uint8Array(values.length * 4);
  values.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  gradientMap = new DataTexture(data, values.length, 1, RGBAFormat);
  gradientMap.minFilter = NearestFilter;
  gradientMap.magFilter = NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

const toonCache = new Map<string, MeshToonMaterial>();
const unlitCache = new Map<string, MeshBasicMaterial>();

export function normalizeHex(color: string): string {
  return `#${new Color(color).getHexString()}`;
}

/** Cached toon material for a colour. Callers must not mutate the result. */
export function toonMaterialFor(color: string): MeshToonMaterial {
  const key = normalizeHex(color);
  let material = toonCache.get(key);
  if (!material) {
    material = new MeshToonMaterial({ color: key, gradientMap: getGradientMap() });
    material.name = `toon:${key}`;
    toonCache.set(key, material);
  }
  return material;
}

/** Cached unlit material for lamps (antenna bulb, chest light). */
export function unlitMaterialFor(color: string): MeshBasicMaterial {
  const key = normalizeHex(color);
  let material = unlitCache.get(key);
  if (!material) {
    material = new MeshBasicMaterial({ color: key, toneMapped: false });
    material.name = `unlit:${key}`;
    unlitCache.set(key, material);
  }
  return material;
}

/** Number of cached materials, for tests and the dev showcase overlay. */
export function materialCacheSize(): number {
  return toonCache.size + unlitCache.size;
}
