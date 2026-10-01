/**
 * Small deterministic value noise for the procedural terrain (#188): a hash
 * of integer lattice points, smoothly interpolated. Pure and seedable, so a
 * layout always builds the same rock and sand.
 */

/** A hash of an integer lattice point to [0, 1). */
export function hash2(x: number, z: number, seed = 0): number {
  let h =
    (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise in [0, 1) at `(x, z)` with a lattice spacing of `scale`. */
export function valueNoise(x: number, z: number, scale = 8, seed = 0): number {
  const fx = x / scale;
  const fz = z / scale;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = smooth(fx - ix);
  const tz = smooth(fz - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

/** Two octaves of value noise, centred on 0 (about -0.5..0.5). */
export function terrainNoise(x: number, z: number, seed = 0): number {
  return valueNoise(x, z, 9, seed) * 0.7 + valueNoise(x, z, 3.5, seed + 17) * 0.3 - 0.5;
}

/** Smoothstep between `e0` and `e1`. */
export function smoothstep(e0: number, e1: number, x: number): number {
  return smooth(Math.min(1, Math.max(0, (x - e0) / (e1 - e0))));
}
