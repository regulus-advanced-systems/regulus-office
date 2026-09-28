/**
 * Nav grid and path planning for click-to-walk (SPEC §9.2): one 0.25 m grid
 * per template (issue #15) built by @regulus/floor-layout from its walls and
 * obstacles, A* between cells, then a string-pulling pass so the avatar walks
 * straight lines instead of staircases. Targets on furniture snap to the
 * nearest walkable cell so clicking a desk walks up to it.
 */
import {
  buildNavGrid,
  type Cell,
  type FloorTemplate,
  findPath,
  type NavGrid,
  type Vec2,
} from "@regulus/floor-layout";

/** Issue #15 asks for a finer grid than the package default (0.5 m). */
export const NAV_CELL_SIZE = 0.25;
/** How far from a blocked click we look for a walkable cell, metres. */
export const SNAP_RADIUS = 1.5;

const grids = new WeakMap<FloorTemplate, NavGrid>();

/** The template's grid, built once and cached per template object. */
export function navGridFor(template: FloorTemplate): NavGrid {
  let grid = grids.get(template);
  if (!grid) {
    grid = buildNavGrid(template, { cellSize: NAV_CELL_SIZE });
    grids.set(template, grid);
  }
  return grid;
}

/**
 * `point` itself when walkable, else the centre of the nearest walkable cell
 * within `radius`, or null when nothing walkable is that close.
 */
export function nearestWalkable(
  grid: NavGrid,
  point: Vec2,
  radius: number = SNAP_RADIUS,
): Vec2 | null {
  if (grid.isWalkable(point.x, point.z)) return point;
  const centre = grid.worldToCell(point.x, point.z);
  const reach = Math.ceil(radius / grid.cellSize);
  let best: Vec2 | null = null;
  let bestDist = radius;
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      const cell: Cell = { col: centre.col + dc, row: centre.row + dr };
      if (!grid.isCellWalkable(cell)) continue;
      const world = grid.cellToWorld(cell);
      const d = Math.hypot(world.x - point.x, world.z - point.z);
      if (d < bestDist) {
        bestDist = d;
        best = world;
      }
    }
  }
  return best;
}

/** True when every point sampled along the segment lies on walkable cells. */
export function lineClear(grid: NavGrid, a: Vec2, b: Vec2): boolean {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(length / (grid.cellSize / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!grid.isWalkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

/** Greedy string pulling: keep only the waypoints needed to keep the line clear. */
export function smoothPath(grid: NavGrid, points: readonly Vec2[]): Vec2[] {
  if (points.length <= 2) return [...points];
  const out: Vec2[] = [points[0] as Vec2];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    for (let i = points.length - 1; i > anchor + 1; i--) {
      if (lineClear(grid, points[anchor] as Vec2, points[i] as Vec2)) {
        next = i;
        break;
      }
    }
    out.push(points[next] as Vec2);
    anchor = next;
  }
  return out;
}

/**
 * Waypoints from `from` to `to` (exclusive of `from`, ending exactly at the
 * snapped target), or null when no route exists. A `from` inside furniture
 * (after a template change, say) is first moved to the nearest free cell.
 */
export function planPath(grid: NavGrid, from: Vec2, to: Vec2): Vec2[] | null {
  const goal = nearestWalkable(grid, to);
  if (!goal) return null;
  const start = nearestWalkable(grid, from);
  if (!start) return null;
  const cells = findPath(
    grid,
    grid.worldToCell(start.x, start.z),
    grid.worldToCell(goal.x, goal.z),
  );
  if (!cells) return null;
  const points: Vec2[] = [from, ...cells.slice(1, -1).map((c) => grid.cellToWorld(c)), goal];
  if (start !== from) points.splice(1, 0, start);
  return smoothPath(grid, points).slice(1);
}
