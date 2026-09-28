/**
 * Procedural grime (SPEC §12: "grime decal at 10-15% on walls/floors";
 * research 03 §3 "painted grime/streaks, not tiled textures"). Generated at
 * runtime as a seeded noise texture that is white with faint dark streaks;
 * used as the `map` of the wall/floor toon materials, so it multiplies the
 * flat palette colour by at most `strength`. No image asset is needed.
 */
import { DataTexture, LinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace } from "three";

export const GRIME_SIZE = 128;
export const GRIME_STRENGTH = 0.13;

/** Deterministic 32-bit PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bilinear value noise over a lattice of `cells` random values, tiling. */
function valueNoise(lattice: Float32Array, cells: number, u: number, v: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (i: number, j: number) =>
    lattice[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)] ?? 0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
  return top + (bottom - top) * sy;
}

/**
 * RGBA pixels of a tileable grime map: grey in [255·(1-strength), 255],
 * alpha 255. Three octaves of value noise stretched vertically so it reads
 * as streaks rather than clouds.
 */
export function grimePixels(
  size = GRIME_SIZE,
  seed = 7,
  strength = GRIME_STRENGTH,
): Uint8ClampedArray {
  const rand = mulberry32(seed);
  const octaves = [4, 8, 16].map((cells) => {
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
    return { cells, lattice };
  });
  const out = new Uint8ClampedArray(size * size * 4);
  const floor = 255 * (1 - strength);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Streaks: squash the horizontal frequency by sampling u at a third of the rate.
      let n = 0;
      let amp = 0.55;
      let total = 0;
      for (const o of octaves) {
        n += valueNoise(o.lattice, o.cells, (u * 0.35) % 1, v) * amp;
        total += amp;
        amp *= 0.55;
      }
      const grey = floor + (255 - floor) * Math.min(1, Math.max(0, n / total));
      const i = (y * size + x) * 4;
      out[i] = grey;
      out[i + 1] = grey;
      out[i + 2] = grey;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Repeating grime texture; set `repeat` per surface so streaks stay roughly 1 m wide. */
export function createGrimeTexture(
  size = GRIME_SIZE,
  seed = 7,
  strength = GRIME_STRENGTH,
): DataTexture {
  const tex = new DataTexture(grimePixels(size, seed, strength), size, size, RGBAFormat);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
