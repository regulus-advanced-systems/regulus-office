/**
 * Roominess checks (issue #118, owner feedback "spacious, not cluttered"):
 * clear walking lanes at least `LANE_WIDTH` wide from the elevator to every
 * desk and interactable, a minimum gap between furniture clusters, and a
 * minimum share of free floor.
 *
 * The nav grid treats chairs as walkable (avatars sit on them), but a chair
 * still takes floor space, so these checks run on a "clearance grid": the nav
 * grid at a finer cell size with a square of `CHAIR_SIZE` blocked around every
 * seat. Not part of `loadTemplate`, so custom templates are not forced to be
 * roomy; the bundled templates are held to it by tests.
 */
import type { Rect } from "./geometry.ts";
import { buildNavGrid, type Cell, type NavGrid } from "./nav-grid.ts";
import { interactables } from "./query.ts";
import type { FloorTemplate, ObstacleKind, Seat } from "./types.ts";

/** Minimum clear width of a walking lane, metres. */
export const LANE_WIDTH = 1.5;
/** Floor a chair or couch cushion takes around its seat pose, metres (square). */
export const CHAIR_SIZE = 0.7;
/** How far from a lane a seat or interactable stand point may be, metres. */
export const LANE_REACH = 1;
/** Cell size of the clearance grid, metres. */
export const CLEARANCE_CELL = 0.25;
/** Minimum share of the interior floor that is free of walls, furniture and chairs. */
export const MIN_FREE_FRACTION = 0.75;

/** Obstacles people sit at; each forms a cluster with its chairs. */
const CLUSTER_KINDS: ReadonlySet<ObstacleKind> = new Set([
  "desk",
  "shared_table",
  "ceo_desk",
  "meeting_table",
  "reception_desk",
  "bistro_table",
]);

export function chairRect(seat: Seat): Rect {
  const h = CHAIR_SIZE / 2;
  return { x: seat.pose.x - h, z: seat.pose.z - h, w: CHAIR_SIZE, d: CHAIR_SIZE };
}

/** Nav grid at `CLEARANCE_CELL` with every seat's chair footprint blocked too. */
export function clearanceGrid(t: FloorTemplate): NavGrid {
  const grid = buildNavGrid(t, { cellSize: CLEARANCE_CELL });
  for (const seat of t.seats) grid.blockRect(chairRect(seat));
  return grid;
}

/** Share of all cells that stay walkable on the clearance grid. */
export function freeFloorFraction(t: FloorTemplate): number {
  const grid = clearanceGrid(t);
  let free = 0;
  for (let i = 0; i < grid.size; i++) if (grid.isCellWalkable(grid.cellAt(i))) free++;
  return free / grid.size;
}

/**
 * Lane cells: every cell covered by some fully free `width` x `width` square
 * (a morphological opening), i.e. where a body `width` wide fits.
 */
export function laneCells(grid: NavGrid, width = LANE_WIDTH): Uint8Array {
  const k = Math.round(width / grid.cellSize);
  const lane = new Uint8Array(grid.size);
  for (let row = 0; row + k <= grid.rows; row++) {
    for (let col = 0; col + k <= grid.cols; col++) {
      if (!windowFree(grid, col, row, k)) continue;
      for (let r = row; r < row + k; r++)
        for (let c = col; c < col + k; c++) lane[grid.index({ col: c, row: r })] = 1;
    }
  }
  return lane;
}

function windowFree(grid: NavGrid, col: number, row: number, k: number): boolean {
  for (let r = row; r < row + k; r++)
    for (let c = col; c < col + k; c++) if (!grid.isCellWalkable({ col: c, row: r })) return false;
  return true;
}

/** Lane cells 4-connected to the lane cell nearest `start`. */
function laneComponent(grid: NavGrid, lane: Uint8Array, start: Cell, reach: number): Set<number> {
  const seed = nearestLaneCell(grid, lane, start, reach);
  const seen = new Set<number>();
  if (seed === undefined) return seen;
  const stack = [seed];
  seen.add(seed);
  while (stack.length > 0) {
    const cell = grid.cellAt(stack.pop() as number);
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const next = { col: cell.col + dc, row: cell.row + dr };
      if (!grid.inBounds(next)) continue;
      const i = grid.index(next);
      if (lane[i] === 1 && !seen.has(i)) {
        seen.add(i);
        stack.push(i);
      }
    }
  }
  return seen;
}

function nearestLaneCell(
  grid: NavGrid,
  lane: Uint8Array | Set<number>,
  from: Cell,
  reach: number,
): number | undefined {
  const has = (i: number) => (lane instanceof Set ? lane.has(i) : lane[i] === 1);
  for (let d = 0; d <= reach; d++) {
    for (let dr = -d; dr <= d; dr++) {
      for (let dc = -d; dc <= d; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== d) continue;
        const cell = { col: from.col + dc, row: from.row + dr };
        if (grid.inBounds(cell) && has(grid.index(cell))) return grid.index(cell);
      }
    }
  }
  return undefined;
}

/**
 * Seats and interactables not within `LANE_REACH` of the lane network that
 * starts at the elevator. Empty when every one of them opens onto a lane at
 * least `LANE_WIDTH` wide connected to the spawn point.
 */
export function laneProblems(t: FloorTemplate): string[] {
  const grid = clearanceGrid(t);
  const lane = laneCells(grid);
  const reach = Math.round(LANE_REACH / grid.cellSize);
  const main = laneComponent(grid, lane, grid.worldToCell(t.spawn.x, t.spawn.z), reach);
  if (main.size === 0) return [`no ${LANE_WIDTH} m lane starts at the elevator`];
  const targets = [
    ...t.seats.map((s) => ({ label: `seat "${s.id}"`, x: s.pose.x, z: s.pose.z })),
    ...interactables(t).map((i) => ({ label: `${i.kind} "${i.id}"`, ...i.standAt })),
  ];
  const problems: string[] = [];
  for (const target of targets) {
    const cell = grid.worldToCell(target.x, target.z);
    if (nearestLaneCell(grid, main, cell, reach) === undefined)
      problems.push(`${target.label} is not within ${LANE_REACH} m of a ${LANE_WIDTH} m lane`);
  }
  return problems;
}

export interface Cluster {
  readonly ids: readonly string[];
  readonly rect: Rect;
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const z = Math.min(a.z, b.z);
  return {
    x,
    z,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    d: Math.max(a.z + a.d, b.z + b.d) - z,
  };
}

/** Clear distance between two rects: the larger of the x and z gaps (negative when they overlap). */
export function rectGap(a: Rect, b: Rect): number {
  const gx = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
  const gz = Math.max(a.z, b.z) - Math.min(a.z + a.d, b.z + b.d);
  return Math.max(gx, gz);
}

/**
 * Furniture people sit at, each grown to cover its chairs. Pieces of one
 * desk that touch (the CEO L-desk's slab and return) merge into one cluster.
 */
export function furnitureClusters(t: FloorTemplate): Cluster[] {
  const clusters: { ids: string[]; rect: Rect; kind: ObstacleKind }[] = [];
  for (const o of t.obstacles) {
    if (!CLUSTER_KINDS.has(o.kind)) continue;
    let rect = o.rect;
    for (const seat of t.seats) if (seat.furnitureId === o.id) rect = union(rect, chairRect(seat));
    const touching = clusters.find((c) => c.kind === o.kind && rectGap(c.rect, o.rect) <= 1e-6);
    if (touching) {
      touching.ids.push(o.id);
      touching.rect = union(touching.rect, rect);
    } else clusters.push({ ids: [o.id], rect, kind: o.kind });
  }
  return clusters.map(({ ids, rect }) => ({ ids, rect }));
}

/** Pairs of furniture clusters closer than `LANE_WIDTH`. */
export function clusterGapProblems(t: FloorTemplate): string[] {
  const clusters = furnitureClusters(t);
  const problems: string[] = [];
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i] as Cluster;
      const b = clusters[j] as Cluster;
      const gap = rectGap(a.rect, b.rect);
      if (gap < LANE_WIDTH - 1e-6)
        problems.push(`"${a.ids[0]}" and "${b.ids[0]}" are ${gap.toFixed(2)} m apart`);
    }
  }
  return problems;
}

/** Every roominess problem; empty when the template is spacious enough. */
export function spacingProblems(t: FloorTemplate): string[] {
  const problems = [...laneProblems(t), ...clusterGapProblems(t)];
  const free = freeFloorFraction(t);
  if (free < MIN_FREE_FRACTION)
    problems.push(`only ${(free * 100).toFixed(0)}% of the floor is free`);
  return problems;
}
