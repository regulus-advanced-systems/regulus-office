/**
 * Minimal A* over a `NavGrid` (octile heuristic, corner cutting prevented by
 * `NavGrid.neighbours`). Good enough for click-to-walk on room-sized grids;
 * #15 may replace it with something smarter without changing callers.
 */
import type { Cell, NavGrid } from "./nav-grid.ts";

const SQRT2 = Math.SQRT2;

function octile(a: Cell, b: Cell): number {
  const dc = Math.abs(a.col - b.col);
  const dr = Math.abs(a.row - b.row);
  return Math.max(dc, dr) + (SQRT2 - 1) * Math.min(dc, dr);
}

/**
 * Shortest cell path from `start` to `goal` inclusive, or `null` when either
 * cell is blocked or no route exists. A start equal to the goal yields `[start]`.
 */
export function findPath(grid: NavGrid, start: Cell, goal: Cell): Cell[] | null {
  if (!grid.isCellWalkable(start) || !grid.isCellWalkable(goal)) return null;
  const startIdx = grid.index(start);
  const goalIdx = grid.index(goal);
  if (startIdx === goalIdx) return [start];

  const gScore = new Float64Array(grid.size).fill(Number.POSITIVE_INFINITY);
  const fScore = new Float64Array(grid.size).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(grid.size).fill(-1);
  const closed = new Uint8Array(grid.size);
  const open: number[] = [startIdx];
  gScore[startIdx] = 0;
  fScore[startIdx] = octile(start, goal);

  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      if ((fScore[open[i] as number] as number) < (fScore[open[best] as number] as number))
        best = i;
    }
    const currentIdx = open[best] as number;
    if (currentIdx === goalIdx) return reconstruct(grid, cameFrom, goalIdx);
    open[best] = open[open.length - 1] as number;
    open.pop();
    closed[currentIdx] = 1;

    const current = grid.cellAt(currentIdx);
    for (const next of grid.neighbours(current)) {
      const nextIdx = grid.index(next);
      if (closed[nextIdx]) continue;
      const step = next.col !== current.col && next.row !== current.row ? SQRT2 : 1;
      const tentative = (gScore[currentIdx] as number) + step;
      if (tentative >= (gScore[nextIdx] as number)) continue;
      cameFrom[nextIdx] = currentIdx;
      gScore[nextIdx] = tentative;
      fScore[nextIdx] = tentative + octile(next, goal);
      if (!open.includes(nextIdx)) open.push(nextIdx);
    }
  }
  return null;
}

function reconstruct(grid: NavGrid, cameFrom: Int32Array, goalIdx: number): Cell[] {
  const path: Cell[] = [];
  for (let i = goalIdx; i !== -1; i = cameFrom[i] as number) path.push(grid.cellAt(i));
  return path.reverse();
}

/** World-space convenience: path of cell centres between two world points. */
export function findWorldPath(
  grid: NavGrid,
  from: { x: number; z: number },
  to: { x: number; z: number },
): { x: number; z: number }[] | null {
  const cells = findPath(grid, grid.worldToCell(from.x, from.z), grid.worldToCell(to.x, to.z));
  return cells ? cells.map((c) => grid.cellToWorld(c)) : null;
}
