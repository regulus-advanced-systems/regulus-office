/**
 * Desk pod slots (#182): where desks can stand in a room of a given size,
 * and the order desks fill them.
 *
 * Pods stand in a grid with a `WALL_BAND` of clear floor along every wall
 * (lanes, the board wall's stand points, wall props) and at least
 * `POD_PITCH` between pod origins (a lane of 2 m between columns and 1.8 m
 * between rows). Leftover space widens every lane evenly. Tables sit on a
 * 0.5 m lattice so all four seats land on nav cell centres.
 *
 * The grid depends only on the room's size, and desks fill slots in a
 * fixed order (nearest the middle of the wall facing the door first, so the
 * free floor and the lounge nook end up by the door): adding a desk never
 * moves the desks already there.
 */
import type { DoorSide } from "@regulus/protocol";
import type { Rect } from "../geometry.ts";
import { POD_D, POD_PITCH, POD_TOP, TABLE_W, TILE, WALL_BAND } from "./constants.ts";

export interface PodSlot {
  /** Position in fill order (desk n stands in slot n - 1). */
  readonly order: number;
  readonly col: number;
  readonly row: number;
  /** North-west corner of the table. */
  readonly tableX: number;
  readonly tableZ: number;
  /** The pod: table plus chairs. */
  readonly rect: Rect;
}

export interface SlotGrid {
  readonly cols: number;
  readonly rows: number;
  /** Every slot, in fill order. */
  readonly slots: readonly PodSlot[];
}

const EPS = 1e-6;
const LATTICE = 0.5;

const snapDown = (v: number) => Math.floor(v / LATTICE + EPS) * LATTICE;

interface Axis {
  count: number;
  /** Origin of the first pod (its west edge, or its top edge on z). */
  first: number;
  pitch: number;
}

/**
 * Lay `size`-long pods along an axis of `length` metres: the first pod
 * origin at or after `lo` (on the lattice offset `phase`), the last pod
 * ending by `length - WALL_BAND`, spare space shared out between all gaps.
 */
function axis(length: number, size: number, lo: number): Axis {
  const avail = length - WALL_BAND - lo;
  if (avail < size - EPS) return { count: 0, first: lo, pitch: POD_PITCH };
  const count = 1 + Math.floor((avail - size) / POD_PITCH + EPS);
  const slack = avail - size - (count - 1) * POD_PITCH;
  const extra = snapDown(slack / (count + 1));
  const rest = slack - (count + 1) * extra;
  return { count, first: lo + extra + snapDown(rest / 2), pitch: POD_PITCH + extra };
}

/**
 * Table x sits on the 0.5 m lattice; the pod's top edge sits at 0.4 mod 0.5
 * so the table's north edge (and both chair rows) land on cell centres.
 */
function axes(widthTiles: number, depthTiles: number): { x: Axis; z: Axis } {
  return {
    x: axis(widthTiles * TILE, TABLE_W, WALL_BAND),
    z: axis(depthTiles * TILE, POD_D, WALL_BAND + 0.4),
  };
}

const cache = new Map<string, SlotGrid>();

/** The pod grid of a `widthTiles` × `depthTiles` room, slots in fill order. */
export function podSlots(widthTiles: number, depthTiles: number, doorSide: DoorSide): SlotGrid {
  const key = `${widthTiles}x${depthTiles}-${doorSide}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { x, z } = axes(widthTiles, depthTiles);
  const w = widthTiles * TILE;
  const d = depthTiles * TILE;
  // The middle of the wall facing the door.
  const hub =
    doorSide === "south"
      ? { x: w / 2, z: 0 }
      : doorSide === "north"
        ? { x: w / 2, z: d }
        : doorSide === "east"
          ? { x: 0, z: d / 2 }
          : { x: w, z: d / 2 };
  const raw: Omit<PodSlot, "order">[] = [];
  for (let row = 0; row < z.count; row++) {
    for (let col = 0; col < x.count; col++) {
      const px = x.first + col * x.pitch;
      const pz = z.first + row * z.pitch;
      raw.push({
        col,
        row,
        tableX: px,
        tableZ: pz + POD_TOP,
        rect: { x: px, z: pz, w: TABLE_W, d: POD_D },
      });
    }
  }
  // Rounded, so mirror-image slots tie exactly and fall back to row, then column.
  const dist = (s: Omit<PodSlot, "order">) =>
    Math.round(Math.hypot(s.rect.x + s.rect.w / 2 - hub.x, s.rect.z + s.rect.d / 2 - hub.z) * 1e3);
  raw.sort((a, b) => dist(a) - dist(b) || a.row - b.row || a.col - b.col);
  const grid = { cols: x.count, rows: z.count, slots: raw.map((s, order) => ({ ...s, order })) };
  cache.set(key, grid);
  return grid;
}
