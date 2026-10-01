/**
 * The mountain the compound is dug into (SPEC §12; #188, the #190 polish
 * note): one faceted, vertex-coloured heightfield over every tile that is
 * not a room or a corridor, plus a margin round the compound where the
 * mountain's shoulders rise, and headlands south of the compound that run
 * down into the sea either side of the beach cove. Rock next to a room or
 * corridor sits just above the walls' tops, so the rooms read as cut into
 * solid rock; further from any room it swells into ridges. Slopes stay
 * gentler than the camera's pitch, so the rock never hides a room behind it.
 *
 * Big, cheap, low-poly: one mesh, one draw, about 20k triangles for a
 * 64-tile compound. Pure (returns a BufferGeometry).
 */
import type { TileRect } from "@regulus/protocol";
import type { BufferGeometry } from "three";
import { WALL_HEIGHT } from "../../lair/dimensions.ts";
import { PartBuilder, type Vec3 } from "../../lair/geometry/builder.ts";
import { LAIR } from "../../lair/palette.ts";
import { coveHalfAt, type OutsideLayout, rockShoreZ, SEA_LEVEL } from "./layout.ts";
import { smoothstep, terrainNoise } from "./noise.ts";

export interface MountainInput {
  /** Compound size, tiles. */
  width: number;
  depth: number;
  tileMetres: number;
  /** Rooms and corridors: no rock over them. */
  open: readonly TileRect[];
  layout: OutsideLayout | null;
}

/** Margin of mountain round the compound, tiles (west/east, north, south); `MARGIN.side` is also where the sea turns deep (water.ts). */
export const MARGIN = { side: 20, north: 18, south: 14 } as const;
/** Rock next to a room or corridor: just above the walls' tops. */
export const ROCK_RIM = WALL_HEIGHT + 0.06;
const RISE_PER_TILE = 0.6;
const RIDGE_MAX = 7;
const SHOULDER_SLOPE = 0.42;
const SHOULDER_MAX = 26;

interface Field {
  i0: number;
  j0: number;
  cols: number;
  rows: number;
  open: Uint8Array;
  /** Distance in tiles from the nearest open tile (chamfer). */
  dist: Float32Array;
}

function field(input: MountainInput): Field {
  const i0 = -MARGIN.side;
  const j0 = -MARGIN.north;
  const cols = input.width + 2 * MARGIN.side;
  const rows = input.depth + MARGIN.north + MARGIN.south;
  const open = new Uint8Array(cols * rows);
  for (const r of input.open) {
    for (let j = r.y; j < r.y + r.d; j++)
      for (let i = r.x; i < r.x + r.w; i++) {
        const c = i - i0;
        const k = j - j0;
        if (c >= 0 && c < cols && k >= 0 && k < rows) open[k * cols + c] = 1;
      }
  }
  // Two-pass chamfer distance (1, √2) from the open tiles.
  const dist = new Float32Array(cols * rows).fill(1e6);
  for (let n = 0; n < open.length; n++) if (open[n]) dist[n] = 0;
  const at = (c: number, k: number) =>
    c < 0 || k < 0 || c >= cols || k >= rows ? 1e6 : (dist[k * cols + c] ?? 1e6);
  const D = Math.SQRT2;
  for (let k = 0; k < rows; k++)
    for (let c = 0; c < cols; c++) {
      const n = k * cols + c;
      dist[n] = Math.min(
        dist[n] ?? 1e6,
        at(c - 1, k) + 1,
        at(c, k - 1) + 1,
        at(c - 1, k - 1) + D,
        at(c + 1, k - 1) + D,
      );
    }
  for (let k = rows - 1; k >= 0; k--)
    for (let c = cols - 1; c >= 0; c--) {
      const n = k * cols + c;
      dist[n] = Math.min(
        dist[n] ?? 1e6,
        at(c + 1, k) + 1,
        at(c, k + 1) + 1,
        at(c + 1, k + 1) + D,
        at(c - 1, k + 1) + D,
      );
    }
  return { i0, j0, cols, rows, open, dist };
}

/** Is the tile (field index) rock to draw? */
function isRock(
  f: Field,
  input: MountainInput,
  c: number,
  k: number,
  h: (ci: number, cj: number) => number,
): boolean {
  if (c < 0 || k < 0 || c >= f.cols || k >= f.rows) return false;
  if (f.open[k * f.cols + c]) return false;
  const j = k + f.j0;
  if (j < input.depth || !input.layout) return true;
  // South of the face: the headlands, outside the cove, above the sea floor.
  const m = input.tileMetres;
  const x = (c + f.i0 + 0.5) * m;
  const s = (j + 0.5) * m - input.depth * m;
  if (Math.abs(x - input.layout.door.centre) <= coveHalfAt(s)) return false;
  const top = Math.max(h(c, k), h(c + 1, k), h(c, k + 1), h(c + 1, k + 1));
  return top > SEA_LEVEL - 0.2;
}

export function mountainGeometry(input: MountainInput): BufferGeometry {
  const f = field(input);
  const m = input.tileMetres;
  const edgeZ = input.depth * m;
  const wM = input.width * m;
  const layout = input.layout;
  const heights = new Float32Array((f.cols + 1) * (f.rows + 1));
  for (let k = 0; k <= f.rows; k++)
    for (let c = 0; c <= f.cols; c++) {
      let d = 1e6;
      for (const [dc, dk] of [
        [-1, -1],
        [0, -1],
        [-1, 0],
        [0, 0],
      ] as const) {
        const cc = c + dc;
        const kk = k + dk;
        if (cc >= 0 && kk >= 0 && cc < f.cols && kk < f.rows)
          d = Math.min(d, f.dist[kk * f.cols + cc] ?? 1e6);
      }
      const x = (c + f.i0) * m;
      const z = (k + f.j0) * m;
      const n = terrainNoise(x, z, 3);
      let h = ROCK_RIM;
      if (d > 0) h += Math.min(d * RISE_PER_TILE, RIDGE_MAX) + n * 1.6 * Math.min(1, d / 3);
      // The mountain's shoulders rise beyond the compound to the west, east and north.
      const out = Math.max(0, -x, x - wM) + Math.max(0, -z);
      h += Math.min(out * SHOULDER_SLOPE, SHOULDER_MAX) * (1 + n * 0.5);
      if (z > edgeZ && layout) {
        // South of the face: headlands that fall away into the sea at the rock's waterline.
        const shore = rockShoreZ(layout, x);
        const fall = smoothstep(shore - 4, shore + 4, z);
        h = h * (1 - fall) + (SEA_LEVEL - 1.4) * fall;
      }
      heights[k * (f.cols + 1) + c] = h;
    }
  const H = (c: number, k: number) => heights[k * (f.cols + 1) + c] ?? 0;
  const P = (c: number, k: number): Vec3 => [(c + f.i0) * m, H(c, k), (k + f.j0) * m];
  const rock = new Uint8Array(f.cols * f.rows);
  for (let k = 0; k < f.rows; k++)
    for (let c = 0; c < f.cols; c++) rock[k * f.cols + c] = isRock(f, input, c, k, H) ? 1 : 0;
  const isR = (c: number, k: number) =>
    c >= 0 && k >= 0 && c < f.cols && k < f.rows && rock[k * f.cols + c] === 1;
  const isOpen = (c: number, k: number) =>
    c >= 0 && k >= 0 && c < f.cols && k < f.rows && f.open[k * f.cols + c] === 1;

  const b = new PartBuilder(188);
  const shade = (a: Vec3, p: Vec3, q: Vec3): { color: string; k: number } => {
    const ux = p[0] - a[0];
    const uy = p[1] - a[1];
    const uz = p[2] - a[2];
    const vx = q[0] - a[0];
    const vy = q[1] - a[1];
    const vz = q[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const flat = Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
    const y = (a[1] + p[1] + q[1]) / 3;
    const cx = (a[0] + p[0] + q[0]) / 3;
    const cz = (a[2] + p[2] + q[2]) / 3;
    const n = terrainNoise(cx * 1.7, cz * 1.7, 11);
    const k = 0.92 + n * 0.22;
    const outside = cx < -2 || cx > wM + 2 || cz < -2 || cz > edgeZ + 1;
    if (y < SEA_LEVEL + 0.4) return { color: LAIR.rockDark, k: k * 0.9 };
    if (outside && flat > 0.82 && n > -0.05 && y > 1)
      return { color: n > 0.18 ? LAIR.leaf : LAIR.leafDark, k };
    if (y < ROCK_RIM + 0.15) return { color: LAIR.rockDark, k };
    if (flat < 0.72) return { color: n > 0.1 ? LAIR.rockCool : LAIR.rock, k: k * 0.9 };
    return { color: y > ROCK_RIM + 4 || n > 0.2 ? LAIR.rockLight : LAIR.rock, k };
  };
  const tri = (a: Vec3, p: Vec3, q: Vec3) => {
    const s = shade(a, p, q);
    b.tri(a, p, q, s.color, s.k);
  };
  for (let k = 0; k < f.rows; k++)
    for (let c = 0; c < f.cols; c++) {
      if (!isR(c, k)) continue;
      const nw = P(c, k);
      const ne = P(c + 1, k);
      const sw = P(c, k + 1);
      const se = P(c + 1, k + 1);
      // Counter-clockwise seen from above (+y); alternate the diagonal for a faceted look.
      if ((c + k) % 2 === 0) {
        tri(nw, sw, se);
        tri(nw, se, ne);
      } else {
        tri(nw, sw, ne);
        tri(ne, sw, se);
      }
      // Cliffs where rock meets sand or sea (not rooms: their walls are there).
      const foot = (p: Vec3): Vec3 => [p[0], SEA_LEVEL - 1.2, p[2]];
      const skirt = (a: Vec3, q: Vec3) => {
        const color = LAIR.rockCool;
        b.quad(foot(a), foot(q), q, a, color, 0.85);
      };
      if (!isR(c, k + 1) && !isOpen(c, k + 1)) skirt(sw, se);
      if (!isR(c, k - 1) && !isOpen(c, k - 1)) skirt(ne, nw);
      if (!isR(c - 1, k) && !isOpen(c - 1, k)) skirt(nw, sw);
      if (!isR(c + 1, k) && !isOpen(c + 1, k)) skirt(se, ne);
    }
  return b.build();
}

/** The rock's height at a corner point (metres), for tests: rim next to open tiles. */
export const MOUNTAIN_RIM = ROCK_RIM;
