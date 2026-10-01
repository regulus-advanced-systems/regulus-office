/**
 * Corridor routing (SPEC §9.1): a corridor {@link CORRIDOR_WIDTH_TILES} tiles
 * wide from each room's door to the network rooted at the lobby (the main
 * corridor), reusing corridor already laid where it can.
 *
 * A corridor is a chain of square blocks the corridor's width on a side,
 * each one tile from the last; a block is identified by its north-west tile
 * (its anchor). A block is free when none of its tiles lies in a room. Each
 * route is a cheapest path (one per step, plus a penalty per turn so
 * corridors run straight) from the block outside the door to any block
 * already in the network; the route's blocks then join the network.
 *
 * Rooms are routed in a fixed order (special rooms, then project rooms by
 * distance from the lobby's door, then id), and ties are broken by a fixed
 * neighbour order and insertion sequence, so the same rooms always give the
 * same corridors whatever order they were passed in.
 */
import { CORRIDOR_WIDTH_TILES, type DoorSide, type TileRect } from "@regulus/protocol";
import { doorFront, type TilePoint } from "./grid.ts";

export interface RouteRoom {
  readonly id: string;
  readonly rect: TileRect;
  readonly doorSide: DoorSide;
  /** Special rooms are routed first. */
  readonly special?: boolean;
}

export interface CorridorNetwork {
  readonly width: number;
  readonly depth: number;
  /** `tiles[y * width + x] === 1` for corridor tiles (main corridor included). */
  readonly tiles: Uint8Array;
  /** Anchors of each room's route, door first; a room already on the network has one. */
  readonly routes: ReadonlyMap<string, readonly TilePoint[]>;
  /** Rooms whose door has no route to the lobby, sorted. */
  readonly unreachable: readonly string[];
}

/** Extra cost of changing direction, in steps. */
export const TURN_PENALTY = 3;

const C = CORRIDOR_WIDTH_TILES;
/** E, S, W, N: the fixed neighbour order. */
const STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const OUTWARD: Readonly<Record<DoorSide, number>> = { east: 0, south: 1, west: 2, north: 3 };

/** Min-heap of `[cost, seq, state]`; `seq` makes ties first-in-first-out. */
class Heap {
  private readonly items: Array<[number, number, number]> = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  push(cost: number, state: number): void {
    const items = this.items;
    items.push([cost, this.seq++, state]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(items[i] as Entry, items[parent] as Entry)) break;
      [items[i], items[parent]] = [items[parent] as Entry, items[i] as Entry];
      i = parent;
    }
  }

  pop(): [number, number, number] | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && less(items[l] as Entry, items[m] as Entry)) m = l;
        if (r < items.length && less(items[r] as Entry, items[m] as Entry)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m] as Entry, items[i] as Entry];
        i = m;
      }
    }
    return top;
  }
}
type Entry = [number, number, number];
const less = (a: Entry, b: Entry) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/**
 * Route every room's corridor. `root` is the main corridor: its tiles are
 * corridor from the start and its blocks are the network the routes join.
 * `lobbyDoor` orders the project rooms (nearest first).
 */
export function routeCorridors(
  width: number,
  depth: number,
  rooms: readonly RouteRoom[],
  root: TileRect,
  lobbyDoor: TilePoint,
): CorridorNetwork {
  const blocked = new Uint8Array(width * depth);
  for (const room of rooms) markRect(blocked, width, depth, room.rect);
  const aw = width - C + 1;
  const ad = depth - C + 1;
  const free = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= aw || y >= ad) return false;
    for (let dy = 0; dy < C; dy++)
      for (let dx = 0; dx < C; dx++) if (blocked[(y + dy) * width + x + dx]) return false;
    return true;
  };

  const tiles = new Uint8Array(width * depth);
  const network = new Uint8Array(Math.max(0, aw * ad));
  const join = (x: number, y: number) => {
    network[y * aw + x] = 1;
    markRect(tiles, width, depth, { x, y, w: C, d: C });
  };
  for (let y = root.y; y + C <= root.y + root.d; y++)
    for (let x = root.x; x + C <= root.x + root.w; x++) if (free(x, y)) join(x, y);

  const routes = new Map<string, TilePoint[]>();
  const unreachable: string[] = [];
  for (const room of routingOrder(rooms, lobbyDoor)) {
    const front = doorFront(room.rect, room.doorSide);
    const path = cheapestRoute(front, OUTWARD[room.doorSide], aw, ad, free, network);
    if (!path) {
      unreachable.push(room.id);
      continue;
    }
    for (const p of path) join(p.x, p.y);
    routes.set(room.id, path);
  }
  return { width, depth, tiles, routes, unreachable: unreachable.sort() };
}

/** Special rooms first, then project rooms nearest the lobby door first; ties by id. */
export function routingOrder(rooms: readonly RouteRoom[], lobbyDoor: TilePoint): RouteRoom[] {
  const dist = (r: RouteRoom) => {
    const f = doorFront(r.rect, r.doorSide);
    return Math.abs(f.x - lobbyDoor.x) + Math.abs(f.y - lobbyDoor.y);
  };
  return [...rooms].sort(
    (a, b) =>
      Number(Boolean(b.special)) - Number(Boolean(a.special)) ||
      dist(a) - dist(b) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function cheapestRoute(
  start: TilePoint,
  startDir: number,
  aw: number,
  ad: number,
  free: (x: number, y: number) => boolean,
  network: Uint8Array,
): TilePoint[] | null {
  if (!free(start.x, start.y)) return null;
  if (network[start.y * aw + start.x]) return [start];
  const states = aw * ad * 4;
  const cost = new Float64Array(states).fill(Number.POSITIVE_INFINITY);
  const from = new Int32Array(states).fill(-1);
  const heap = new Heap();
  const s0 = (start.y * aw + start.x) * 4 + startDir;
  cost[s0] = 0;
  heap.push(0, s0);
  while (heap.size > 0) {
    const [c, , state] = heap.pop() as Entry;
    if (c > (cost[state] as number)) continue;
    const cell = state >> 2;
    const dir = state & 3;
    if (network[cell]) return unwind(from, state, aw);
    const x = cell % aw;
    const y = (cell - x) / aw;
    for (let d = 0; d < 4; d++) {
      const [sx, sy] = STEPS[d] as readonly [number, number];
      const nx = x + sx;
      const ny = y + sy;
      if (!free(nx, ny)) continue;
      const next = (ny * aw + nx) * 4 + d;
      const nc = c + 1 + (d === dir ? 0 : TURN_PENALTY);
      if (nc < (cost[next] as number)) {
        cost[next] = nc;
        from[next] = state;
        heap.push(nc, next);
      }
    }
  }
  return null;
}

function unwind(from: Int32Array, end: number, aw: number): TilePoint[] {
  const path: TilePoint[] = [];
  for (let s = end; s !== -1; s = from[s] as number) {
    const cell = s >> 2;
    path.push({ x: cell % aw, y: Math.floor(cell / aw) });
  }
  return path.reverse();
}

function markRect(grid: Uint8Array, width: number, depth: number, r: TileRect): void {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(width, r.x + r.w);
  const y1 = Math.min(depth, r.y + r.d);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) grid[y * width + x] = 1;
}
