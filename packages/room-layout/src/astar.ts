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
  const cameFrom = new Int32Array(grid.size).fill(-1);
  const closed = new Uint8Array(grid.size);
  // Binary min-heap on f (lazy deletion: stale entries are skipped when popped), so a
  // compound-sized grid (#186, ~300k cells) plans in milliseconds, not seconds.
  const open = new MinHeap();
  gScore[startIdx] = 0;
  open.push(startIdx, octile(start, goal));

  while (open.size > 0) {
    const currentIdx = open.pop();
    if (closed[currentIdx]) continue;
    if (currentIdx === goalIdx) return reconstruct(grid, cameFrom, goalIdx);
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
      open.push(nextIdx, tentative + octile(next, goal));
    }
  }
  return null;
}

/** Array-backed binary heap of cell indices keyed by f-score; ties pop in insertion order. */
class MinHeap {
  private keys: number[] = [];
  private items: number[] = [];
  private order: number[] = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  private less(a: number, b: number): boolean {
    const ka = this.keys[a] as number;
    const kb = this.keys[b] as number;
    return ka < kb || (ka === kb && (this.order[a] as number) < (this.order[b] as number));
  }

  private swap(a: number, b: number): void {
    for (const arr of [this.keys, this.items, this.order]) {
      const t = arr[a] as number;
      arr[a] = arr[b] as number;
      arr[b] = t;
    }
  }

  push(item: number, key: number): void {
    this.keys.push(key);
    this.items.push(item);
    this.order.push(this.seq++);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0] as number;
    const last = this.items.length - 1;
    this.swap(0, last);
    this.keys.pop();
    this.items.pop();
    this.order.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.items.length && this.less(l, m)) m = l;
      if (r < this.items.length && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
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
