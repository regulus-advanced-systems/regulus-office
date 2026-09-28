/**
 * Walkability grid generated from a template's walls, obstacles and elevator.
 * Cells are `cellSize` metres square, indexed by column (x) and row (z) from
 * the room's north-west corner. Consumers (click-to-walk A*, #15) only need
 * `isWalkable`, `worldToCell`, `cellToWorld` and `neighbours`.
 */
import { type Rect, rectsOverlap, type Vec2 } from "./geometry.ts";
import { wallRect } from "./query.ts";
import type { FloorTemplate } from "./types.ts";

export const DEFAULT_CELL_SIZE = 0.5;

export interface Cell {
  readonly col: number;
  readonly row: number;
}

export interface NavGridOptions {
  /** Cell edge length in metres (default 0.5). */
  cellSize?: number;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly walkable: Uint8Array;

  constructor(
    readonly width: number,
    readonly depth: number,
    readonly cellSize: number = DEFAULT_CELL_SIZE,
  ) {
    this.cols = Math.max(1, Math.ceil(width / cellSize - 1e-9));
    this.rows = Math.max(1, Math.ceil(depth / cellSize - 1e-9));
    this.walkable = new Uint8Array(this.cols * this.rows).fill(1);
  }

  /** Total number of cells. */
  get size(): number {
    return this.cols * this.rows;
  }

  inBounds(cell: Cell): boolean {
    return cell.col >= 0 && cell.col < this.cols && cell.row >= 0 && cell.row < this.rows;
  }

  /** Stable index for a cell (for visited sets, came-from maps). */
  index(cell: Cell): number {
    return cell.row * this.cols + cell.col;
  }

  cellAt(index: number): Cell {
    return { col: index % this.cols, row: Math.floor(index / this.cols) };
  }

  isCellWalkable(cell: Cell): boolean {
    return this.inBounds(cell) && this.walkable[this.index(cell)] === 1;
  }

  /** Walkability of the cell containing the world point `(x, z)`. */
  isWalkable(x: number, z: number): boolean {
    return this.isCellWalkable(this.worldToCell(x, z));
  }

  setWalkable(cell: Cell, value: boolean): void {
    if (this.inBounds(cell)) this.walkable[this.index(cell)] = value ? 1 : 0;
  }

  worldToCell(x: number, z: number): Cell {
    return { col: Math.floor(x / this.cellSize), row: Math.floor(z / this.cellSize) };
  }

  /** Centre of a cell in world metres. */
  cellToWorld(cell: Cell): Vec2 {
    return { x: (cell.col + 0.5) * this.cellSize, z: (cell.row + 0.5) * this.cellSize };
  }

  /** Ground footprint of a cell. */
  cellRect(cell: Cell): Rect {
    return {
      x: cell.col * this.cellSize,
      z: cell.row * this.cellSize,
      w: this.cellSize,
      d: this.cellSize,
    };
  }

  /**
   * Walkable 8-connected neighbours. Diagonal steps are allowed only when both
   * orthogonal cells beside them are walkable, so paths never cut corners.
   */
  neighbours(cell: Cell): Cell[] {
    const out: Cell[] = [];
    for (const [dc, dr] of DIRS) {
      const next = { col: cell.col + dc, row: cell.row + dr };
      if (!this.isCellWalkable(next)) continue;
      if (dc !== 0 && dr !== 0) {
        const sideA = { col: cell.col + dc, row: cell.row };
        const sideB = { col: cell.col, row: cell.row + dr };
        if (!this.isCellWalkable(sideA) || !this.isCellWalkable(sideB)) continue;
      }
      out.push(next);
    }
    return out;
  }

  /** Mark every cell overlapping `rect` as blocked. */
  blockRect(rect: Rect): void {
    const c0 = Math.max(0, Math.floor(rect.x / this.cellSize));
    const c1 = Math.min(this.cols - 1, Math.ceil((rect.x + rect.w) / this.cellSize));
    const r0 = Math.max(0, Math.floor(rect.z / this.cellSize));
    const r1 = Math.min(this.rows - 1, Math.ceil((rect.z + rect.d) / this.cellSize));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cell = { col, row };
        if (rectsOverlap(this.cellRect(cell), rect)) this.setWalkable(cell, false);
      }
    }
  }

  /** Indices of every cell reachable from `start` (flood fill using `neighbours`). */
  reachableFrom(start: Cell): Set<number> {
    const seen = new Set<number>();
    if (!this.isCellWalkable(start)) return seen;
    const stack: Cell[] = [start];
    seen.add(this.index(start));
    while (stack.length > 0) {
      const cell = stack.pop() as Cell;
      for (const next of this.neighbours(cell)) {
        const i = this.index(next);
        if (!seen.has(i)) {
          seen.add(i);
          stack.push(next);
        }
      }
    }
    return seen;
  }

  /** Debug rendering: `.` walkable, `#` blocked; one line per row, north first. */
  toAscii(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.rows; row++) {
      let line = "";
      for (let col = 0; col < this.cols; col++)
        line += this.walkable[this.index({ col, row })] ? "." : "#";
      lines.push(line);
    }
    return lines.join("\n");
  }
}

/** Build the grid for a template: walls, the elevator recess and every obstacle block. */
export function buildNavGrid(template: FloorTemplate, options: NavGridOptions = {}): NavGrid {
  const grid = new NavGrid(template.size.width, template.size.depth, options.cellSize);
  for (const wall of template.walls) grid.blockRect(wallRect(wall));
  grid.blockRect(template.elevator.rect);
  for (const obstacle of template.obstacles) grid.blockRect(obstacle.rect);
  return grid;
}
