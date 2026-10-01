/**
 * The beach and the sea (SPEC §12 Outside: pale sand, turquoise shallows,
 * deep blue sea; "cheap stylised water"; #188). Pure geometry builders:
 *
 * - the sand: a vertex-coloured grid over the cove, flat (walkable, y = 0)
 *   down to just before the waterline, then shelving under the sea;
 * - the sea: one coarse grid out to the horizon with a per-vertex `depth`
 *   (metres from the waterline) and pre-mixed colours, so the shader only
 *   adds moving foam and banding, and the low tier needs no shader at all.
 */
import { BufferAttribute, BufferGeometry, Color } from "three";
import {
  coveHalfAt,
  type OutsideLayout,
  rockShoreZ,
  SEA_LEVEL,
  SHORE_MARGIN,
  shoreZ,
} from "./layout.ts";
import { smoothstep, terrainNoise } from "./noise.ts";

export const SAND = {
  dry: "#E6D5A8",
  dryLight: "#F0E2B9",
  wet: "#C7AE7C",
  under: "#8FA28A",
} as const;

export const SEA = {
  shallow: "#3FD3C6",
  mid: "#1E9FB8",
  deep: "#1A4F8C",
  far: "#163A6A",
  foam: "#F4FBF8",
} as const;

/** Sand height at a point: flat to just before the waterline, then shelving under the sea. */
export function sandHeight(layout: OutsideLayout, x: number, z: number): number {
  const flatTo = shoreZ(layout, x) - SHORE_MARGIN;
  if (z <= flatTo) return 0;
  // Reaches sea level at the waterline, then keeps going down.
  return Math.max(-2, ((z - flatTo) * SEA_LEVEL) / SHORE_MARGIN);
}

const SAND_STEP = 1;

/** The sand's colour at a point: dry and pale up the beach, darker where the waves wet it. */
export function sandColor(layout: OutsideLayout, x: number, z: number, out = new Color()): Color {
  const shore = shoreZ(layout, x);
  const n = terrainNoise(x * 1.3, z * 1.3, 5);
  out.set(n > 0.1 ? SAND.dryLight : SAND.dry);
  const wet = smoothstep(shore - SHORE_MARGIN - 2.2, shore - SHORE_MARGIN - 0.6, z);
  out.lerp(new Color(SAND.wet), wet);
  out.lerp(new Color(SAND.under), smoothstep(shore, shore + 1.5, z));
  return out.multiplyScalar(0.97 + n * 0.08);
}

/** The cove's sand, metres: an indexed, smooth, vertex-coloured grid. */
export function sandGeometry(layout: OutsideLayout): BufferGeometry {
  const c = layout.door.centre;
  const x0 = c - coveHalfAt(20) - 4;
  const z0 = layout.edgeZ;
  const cols = Math.ceil((2 * (coveHalfAt(20) + 4)) / SAND_STEP);
  const rows = Math.ceil(24 / SAND_STEP);
  const pos: number[] = [];
  const col: number[] = [];
  const tmp = new Color();
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const x = x0 + i * SAND_STEP;
      const z = z0 + j * SAND_STEP;
      pos.push(x, sandHeight(layout, x, z), z);
      sandColor(layout, x, z, tmp);
      col.push(tmp.r, tmp.g, tmp.b);
    }
  const index: number[] = [];
  const n = cols + 1;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * n + i;
      index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Rows of the sea grid: fine near the shore, coarse toward the horizon (metres south of the face). */
const SEA_ROWS = [
  0, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 23, 26, 30, 36, 44, 56, 72, 95, 130, 180,
  250, 340,
];
const SEA_HALF_WIDTH = 220;
const SEA_COL = 4;

/** Past the mountain's east and west ends the sea is open and deep, metres beyond the compound. */
const OPEN_SEA_BEYOND = 36;

/** Distance from the waterline at a point, metres (negative on land). */
export function seaDepth(layout: OutsideLayout, x: number, z: number): number {
  if (x < -OPEN_SEA_BEYOND || x > layout.widthM + OPEN_SEA_BEYOND) return z - layout.edgeZ + 30;
  return z - rockShoreZ(layout, x);
}

/** The colour of open water `depth` metres from the shore. */
export function seaColor(depth: number, out = new Color()): Color {
  const t = Math.max(0, depth);
  if (t < 6) return out.set(SEA.shallow).lerp(new Color(SEA.mid), t / 6);
  if (t < 30) return out.set(SEA.mid).lerp(new Color(SEA.deep), (t - 6) / 24);
  return out.set(SEA.deep).lerp(new Color(SEA.far), Math.min(1, (t - 30) / 200));
}

/**
 * The sea: an indexed grid at sea level with `depth` and colour per vertex.
 * `halfWidth` and `rows` shrink it for the low tier.
 */
export function seaGeometry(
  layout: OutsideLayout,
  opts: { halfWidth?: number; reach?: number } = {},
): BufferGeometry {
  const half = opts.halfWidth ?? SEA_HALF_WIDTH;
  const reach = opts.reach ?? SEA_ROWS[SEA_ROWS.length - 1] ?? 340;
  const rows = SEA_ROWS.filter((r) => r <= reach);
  const xs: number[] = [];
  for (let x = layout.door.centre - half; x <= layout.door.centre + half + 1e-6; x += SEA_COL)
    xs.push(x);
  const pos: number[] = [];
  const depth: number[] = [];
  const col: number[] = [];
  const c = new Color();
  for (const r of rows)
    for (const x of xs) {
      const z = layout.edgeZ + r;
      const d = seaDepth(layout, x, z);
      pos.push(x, SEA_LEVEL, z);
      depth.push(d);
      seaColor(d + terrainNoise(x, z, 9) * 2, c);
      col.push(c.r, c.g, c.b);
    }
  const index: number[] = [];
  const n = xs.length;
  for (let j = 0; j < rows.length - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      index.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  geo.setAttribute("depth", new BufferAttribute(new Float32Array(depth), 1));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}
