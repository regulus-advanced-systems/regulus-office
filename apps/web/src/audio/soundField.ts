/**
 * Walking distance from a sound source to every cell of the compound's nav
 * grid (#47; reusable by #48): sound in the lair goes round walls and out
 * through doorways, so a player on the other side of a wall hears less
 * than the straight line suggests. A bounded Dijkstra over the grid's
 * 8-connected cells (diagonals cost √2, no corner cutting, as A* walks),
 * stopping at `maxDistance`, so it only visits the cells that can hear the
 * source (about 50 000 at 0.25 m cells for a 55 m reach) and runs once per
 * grid change, not per frame. Lookups are O(1).
 */

/** The parts of @regulus/room-layout's NavGrid the field reads. */
export interface FieldGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  isCellWalkable(cell: { col: number; row: number }): boolean;
}

export interface SoundField {
  /** Walking distance (metres) from the source to `(x, z)`; Infinity when out of reach. */
  distanceAt(x: number, z: number): number;
  /** Cells the search settled (tests, perf). */
  readonly visited: number;
}

const SQRT2 = Math.SQRT2;
/** How far (cells) a listener off the walkable grid looks for a reached cell. */
const LISTENER_SLACK_CELLS = 4;
const STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/** Minimal binary heap of cell indices keyed by distance. */
class Heap {
  private readonly items: number[] = [];
  private readonly keys: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, key: number) {
    let i = this.items.length;
    this.items.push(item);
    this.keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.keys[p] as number) <= key) break;
      this.items[i] = this.items[p] as number;
      this.keys[i] = this.keys[p] as number;
      i = p;
    }
    this.items[i] = item;
    this.keys[i] = key;
  }
  pop(): [number, number] {
    const top: [number, number] = [this.items[0] as number, this.keys[0] as number];
    const item = this.items.pop() as number;
    const key = this.keys.pop() as number;
    const n = this.items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && (this.keys[r] as number) < (this.keys[l] as number) ? r : l;
        if ((this.keys[c] as number) >= key) break;
        this.items[i] = this.items[c] as number;
        this.keys[i] = this.keys[c] as number;
        i = c;
      }
      this.items[i] = item;
      this.keys[i] = key;
    }
    return top;
  }
}

/** The walkable cell nearest to `(x, z)` within `reach` metres (the source stands on furniture). */
function nearestWalkable(grid: FieldGrid, x: number, z: number, reach: number) {
  const c0 = Math.floor(x / grid.cellSize);
  const r0 = Math.floor(z / grid.cellSize);
  const rings = Math.ceil(reach / grid.cellSize);
  let best: { col: number; row: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let dr = -rings; dr <= rings; dr++) {
    for (let dc = -rings; dc <= rings; dc++) {
      const cell = { col: c0 + dc, row: r0 + dr };
      if (!grid.isCellWalkable(cell)) continue;
      const d = Math.hypot(
        (cell.col + 0.5) * grid.cellSize - x,
        (cell.row + 0.5) * grid.cellSize - z,
      );
      if (d < bestD) {
        bestD = d;
        best = cell;
      }
    }
  }
  return best ? { cell: best, offset: bestD } : null;
}

/** Distances from a source at `(x, z)` out to `maxDistance` metres of walking. */
export function buildSoundField(
  grid: FieldGrid,
  source: { x: number; z: number },
  maxDistance: number,
): SoundField {
  const { cols, rows, cellSize } = grid;
  const dist = new Float32Array(cols * rows).fill(Number.POSITIVE_INFINITY);
  const start = nearestWalkable(grid, source.x, source.z, 3);
  let visited = 0;
  if (start) {
    // Walkability is asked once per cell and cached (0 unknown, 1 open, 2 blocked); one probe object.
    const known = new Uint8Array(cols * rows);
    const probe = { col: 0, row: 0 };
    const walkable = (col: number, row: number) => {
      if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
      const i = row * cols + col;
      let k = known[i] as number;
      if (k === 0) {
        probe.col = col;
        probe.row = row;
        k = grid.isCellWalkable(probe) ? 1 : 2;
        known[i] = k;
      }
      return k === 1;
    };
    const heap = new Heap();
    const s = start.cell.row * cols + start.cell.col;
    dist[s] = Math.fround(start.offset);
    heap.push(s, dist[s] as number);
    while (heap.size > 0) {
      const [i, d] = heap.pop();
      if (d > (dist[i] as number)) continue;
      visited += 1;
      const col = i % cols;
      const row = (i - col) / cols;
      for (const [dc, dr, cost] of STEPS) {
        const nc = col + dc;
        const nr = row + dr;
        if (!walkable(nc, nr)) continue;
        if (dc !== 0 && dr !== 0 && (!walkable(col + dc, row) || !walkable(col, row + dr)))
          continue;
        // Rounded as the Float32Array stores it, or the heap entry would look stale.
        const nd = Math.fround(d + cost * cellSize);
        const ni = nr * cols + nc;
        if (nd >= (dist[ni] as number) || nd > maxDistance) continue;
        dist[ni] = nd;
        heap.push(ni, nd);
      }
    }
  }
  return {
    visited,
    distanceAt(x, z) {
      const col = Math.floor(x / cellSize);
      const row = Math.floor(z / cellSize);
      // A seated listener stands in a chair's blocked cell: take the nearest reached cell.
      let best = Number.POSITIVE_INFINITY;
      for (let ring = 0; ring <= LISTENER_SLACK_CELLS && best === Infinity; ring++) {
        for (let r = row - ring; r <= row + ring; r++) {
          for (let c = col - ring; c <= col + ring; c++) {
            if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
            const d = (dist[r * cols + c] as number) + ring * cellSize;
            if (d < best) best = d;
          }
        }
      }
      return best;
    },
  };
}
