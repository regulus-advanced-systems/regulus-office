/**
 * The compound's fixed parts (SPEC §9.1): the lobby at the south edge with
 * its blast door onto the beach, the conference/war room and the break room
 * beside it, and the main corridor running east-west just north of them.
 * Everything here derives from the compound size and the stored lobby
 * placement, so only those are persisted (the `compound` row).
 */
import {
  CORRIDOR_WIDTH_TILES,
  DEFAULT_COMPOUND_SIZE_TILES,
  type DoorSide,
  MAX_COMPOUND_SIZE_TILES,
  MIN_COMPOUND_SIZE_TILES,
  type SpecialRoomKind,
  type TileRect,
} from "@regulus/protocol";
import { tileRectInBounds } from "./grid.ts";

/** What the `compound` row stores: grid bounds and the lobby's footprint. */
export interface CompoundSpec {
  readonly width: number;
  readonly depth: number;
  readonly lobby: TileRect;
  /**
   * A level other than the lobby level (D26, #269): the lift landing stands
   * on the lobby's footprint (the lift shaft runs through every level at the
   * same spot); there is no war room, break room, blast door or beach.
   * Never stored: {@link landingSpec} derives it from the one stored spec.
   */
  readonly landing?: boolean;
}

/** The spec of a level other than the lobby level: same grid, a lift landing as its only fixed room. */
export function landingSpec(spec: CompoundSpec): CompoundSpec {
  return spec.landing ? spec : { ...spec, landing: true };
}

export interface SpecialRoom {
  readonly kind: SpecialRoomKind;
  readonly rect: TileRect;
  readonly doorSide: DoorSide;
}

export const LOBBY_TILES = { w: 12, d: 8 } as const;
export const CONFERENCE_TILES = { w: 10, d: 8 } as const;
export const BREAK_ROOM_TILES = { w: 8, d: 8 } as const;
/** Space between the lobby and the special rooms beside it. */
export const SPECIAL_ROOM_GAP_TILES = 4;
/** The main corridor stops this far from the compound's east and west edges. */
export const MAIN_CORRIDOR_MARGIN_TILES = 2;
export const BLAST_DOOR_TILES = 4;

/** The default compound: `width × depth` tiles, the lobby centred on the south edge. */
export function defaultCompoundSpec(
  width: number = DEFAULT_COMPOUND_SIZE_TILES,
  depth: number = width,
): CompoundSpec {
  return {
    width,
    depth,
    lobby: {
      x: Math.floor((width - LOBBY_TILES.w) / 2),
      y: depth - LOBBY_TILES.d,
      w: LOBBY_TILES.w,
      d: LOBBY_TILES.d,
    },
  };
}

/**
 * Lobby (door north onto the main corridor), conference room west of it, break
 * room east; on a level other than the lobby level, only the lift landing.
 * The first entry is always the room people arrive in.
 */
export function specialRooms(spec: CompoundSpec): SpecialRoom[] {
  const { lobby } = spec;
  if (spec.landing) return [{ kind: "landing", rect: lobby, doorSide: "north" }];
  const south = lobby.y + lobby.d;
  return [
    { kind: "lobby", rect: lobby, doorSide: "north" },
    {
      kind: "conference",
      rect: {
        x: lobby.x - SPECIAL_ROOM_GAP_TILES - CONFERENCE_TILES.w,
        y: south - CONFERENCE_TILES.d,
        w: CONFERENCE_TILES.w,
        d: CONFERENCE_TILES.d,
      },
      doorSide: "north",
    },
    {
      kind: "break_room",
      rect: {
        x: lobby.x + lobby.w + SPECIAL_ROOM_GAP_TILES,
        y: south - BREAK_ROOM_TILES.d,
        w: BREAK_ROOM_TILES.w,
        d: BREAK_ROOM_TILES.d,
      },
      doorSide: "north",
    },
  ];
}

/** The corridor network's root: an east-west corridor along the lobby's north wall. */
export function mainCorridor(spec: CompoundSpec): TileRect {
  return {
    x: MAIN_CORRIDOR_MARGIN_TILES,
    y: spec.lobby.y - CORRIDOR_WIDTH_TILES,
    w: spec.width - 2 * MAIN_CORRIDOR_MARGIN_TILES,
    d: CORRIDOR_WIDTH_TILES,
  };
}

/**
 * The blast door: a segment of the lobby's south wall (on the compound's south
 * edge). Only the lobby level has one (width 0 elsewhere: solid rock).
 */
export function blastDoor(spec: CompoundSpec): { x: number; y: number; width: number } {
  const { lobby } = spec;
  if (spec.landing) return { x: lobby.x, y: lobby.y + lobby.d, width: 0 };
  return {
    x: lobby.x + Math.floor((lobby.w - BLAST_DOOR_TILES) / 2),
    y: lobby.y + lobby.d,
    width: BLAST_DOOR_TILES,
  };
}

/** Problems with a stored spec (size range, lobby on the south edge, special rooms inside). */
export function compoundSpecProblems(spec: CompoundSpec): string[] {
  const problems: string[] = [];
  for (const [name, v] of [
    ["width", spec.width],
    ["depth", spec.depth],
  ] as const) {
    if (!Number.isInteger(v) || v < MIN_COMPOUND_SIZE_TILES || v > MAX_COMPOUND_SIZE_TILES) {
      problems.push(`${name} must be ${MIN_COMPOUND_SIZE_TILES}..${MAX_COMPOUND_SIZE_TILES}`);
    }
  }
  if (spec.lobby.y + spec.lobby.d !== spec.depth) problems.push("lobby must touch the south edge");
  for (const room of specialRooms(spec)) {
    if (!tileRectInBounds(room.rect, spec.width, spec.depth)) {
      problems.push(`${room.kind} is outside the compound`);
    }
  }
  if (!tileRectInBounds(mainCorridor(spec), spec.width, spec.depth)) {
    problems.push("main corridor is outside the compound");
  }
  return problems;
}
