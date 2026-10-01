/**
 * The compound nav grid (SPEC §9.1, §9.2): one {@link NavGrid} over the whole
 * compound plus the beach strip, in world metres from the compound's
 * north-west corner. Walkable: corridors, room floors, open doors and the
 * outside strip. Rock (everything else) and room walls block; the blast door
 * blocks unless open, and doors listed in `closedDoors` stay shut (rooms the
 * viewer may not enter). Interiors add their furniture through `obstacles`.
 */
import {
  COMPOUND_TILE_METRES,
  DOOR_WIDTH_TILES,
  type DoorSide,
  type TileRect,
} from "@regulus/protocol";
import type { Rect } from "../geometry.ts";
import { DEFAULT_CELL_SIZE, NavGrid } from "../nav-grid.ts";
import type { TilePoint } from "./grid.ts";

/** What the nav grid needs; a {@link CompoundLayout} or the published state both map to it. */
export interface CompoundNavInput {
  readonly width: number;
  readonly depth: number;
  readonly outsideDepth: number;
  /** Every room with a door: special rooms and project rooms. */
  readonly rooms: ReadonlyArray<{
    readonly id: string;
    readonly rect: TileRect;
    readonly doorSide: DoorSide;
    readonly door: TilePoint;
  }>;
  readonly corridors: readonly TileRect[];
  readonly blastDoor: { readonly x: number; readonly y: number; readonly width: number };
}

export interface CompoundNavOptions {
  /** Cell edge in metres (default 0.5, like room grids). */
  cellSize?: number;
  /** The blast door is live state (SPEC §5 `compound`); closed by default. */
  blastDoorOpen?: boolean;
  /** Rooms whose door stays shut (no access, or still being built). */
  closedDoors?: ReadonlySet<string>;
  /** Furniture and other blockers, world metres. */
  obstacles?: readonly Rect[];
}

const M = COMPOUND_TILE_METRES;

const toMetres = (r: TileRect): Rect => ({ x: r.x * M, z: r.y * M, w: r.w * M, d: r.d * M });

/** Set every cell lying entirely inside `rect` (metres). */
function fill(grid: NavGrid, rect: Rect, walkable: boolean): void {
  const cs = grid.cellSize;
  const c0 = Math.max(0, Math.round(rect.x / cs));
  const r0 = Math.max(0, Math.round(rect.z / cs));
  const c1 = Math.min(grid.cols, Math.round((rect.x + rect.w) / cs));
  const r1 = Math.min(grid.rows, Math.round((rect.z + rect.d) / cs));
  for (let row = r0; row < r1; row++)
    for (let col = c0; col < c1; col++) grid.setWalkable({ col, row }, walkable);
}

/** The strip of cells just inside a room's wall on `side`, one cell thick (metres). */
function wallStrip(room: TileRect, side: DoorSide, cs: number): Rect {
  const r = toMetres(room);
  switch (side) {
    case "north":
      return { x: r.x, z: r.z, w: r.w, d: cs };
    case "south":
      return { x: r.x, z: r.z + r.d - cs, w: r.w, d: cs };
    case "west":
      return { x: r.x, z: r.z, w: cs, d: r.d };
    case "east":
      return { x: r.x + r.w - cs, z: r.z, w: cs, d: r.d };
  }
}

/** The door's opening cut through `wallStrip` (metres). */
function opening(side: DoorSide, at: TilePoint, widthTiles: number, cs: number): Rect {
  const along = widthTiles * M;
  switch (side) {
    case "north":
      return { x: at.x * M, z: at.y * M, w: along, d: cs };
    case "south":
      return { x: at.x * M, z: at.y * M - cs, w: along, d: cs };
    case "west":
      return { x: at.x * M, z: at.y * M, w: cs, d: along };
    case "east":
      return { x: at.x * M - cs, z: at.y * M, w: cs, d: along };
  }
}

export function buildCompoundNavGrid(
  input: CompoundNavInput,
  options: CompoundNavOptions = {},
): NavGrid {
  const cs = options.cellSize ?? DEFAULT_CELL_SIZE;
  const grid = new NavGrid(input.width * M, (input.depth + input.outsideDepth) * M, cs);
  fill(grid, { x: 0, z: 0, w: grid.cols * cs, d: grid.rows * cs }, false);
  fill(grid, { x: 0, z: input.depth * M, w: input.width * M, d: input.outsideDepth * M }, true);
  for (const c of input.corridors) fill(grid, toMetres(c), true);
  for (const room of input.rooms) {
    fill(grid, toMetres(room.rect), true);
    for (const side of ["north", "south", "east", "west"] as const) {
      fill(grid, wallStrip(room.rect, side, cs), false);
    }
    if (!options.closedDoors?.has(room.id)) {
      fill(grid, opening(room.doorSide, room.door, DOOR_WIDTH_TILES, cs), true);
    }
  }
  if (options.blastDoorOpen) {
    const b = input.blastDoor;
    fill(grid, opening("south", { x: b.x, y: b.y }, b.width, cs), true);
  }
  for (const o of options.obstacles ?? []) grid.blockRect(o);
  return grid;
}
