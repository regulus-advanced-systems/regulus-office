/**
 * The compound as the client sees it (SPEC §9.1, #186): every room of the
 * published layout (the special rooms and the placed project rooms) with its
 * footprint in metres, door, build state, counters and whether this viewer
 * may enter it, plus the corridors. A room marked closed (D26, #269) is its
 * footprint and nothing more. Pure: built from the BuildingRoom state
 * and the REST operation list, then shared by the scene, navigation, presence
 * and quick travel.
 *
 * Coordinates are compound metres (protocol `compound.ts`): x east, z south,
 * origin at the compound's north-west corner; a room's interior is drawn in
 * its own frame with its north-west corner at `origin`.
 */

import {
  type BuildingState,
  DEFAULT_ROOM_SETTINGS,
  type DecorStyle,
  DOOR_SIDES,
  type DoorSide,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  type OperationSummary,
  type RoomBuildState,
  type SpecialRoomKind,
  type TileRect,
} from "@regulus/protocol";
import { doorApproach, doorStart, type Pose } from "@regulus/room-layout";

export type WorldRoomKind = "project" | SpecialRoomKind;

export interface WorldRoom {
  /** Operation id for project rooms and the lobby; the special room's kind otherwise. */
  readonly id: string;
  readonly kind: WorldRoomKind;
  readonly name: string;
  readonly rect: TileRect;
  readonly doorSide: DoorSide;
  /** Grid point where the door starts (protocol conventions). */
  readonly door: { readonly x: number; readonly y: number };
  /** North-west corner, metres. */
  readonly origin: { readonly x: number; readonly z: number };
  /** Footprint, metres. */
  readonly size: { readonly w: number; readonly d: number };
  /** May this viewer walk in (special rooms: always; project rooms: in the REST list). */
  readonly enterable: boolean;
  /**
   * A room this viewer may not know anything about (D26, #269): only its
   * footprint is known. It has no name, counts or interior here, whatever
   * was published, and is never enterable.
   */
  readonly closed: boolean;
  /** A closed room whose door is not known: drawn as solid rock (the door fields are then made up). */
  readonly sealed: boolean;
  readonly buildState: RoomBuildState;
  readonly buildEndsAt: number;
  readonly deskCount: number;
  readonly decorStyle: DecorStyle;
  readonly henchmenWorking: number;
  readonly henchmenWaiting: number;
  readonly henchmenTotal: number;
}

export interface CompoundWorld {
  /** The level this is the world of (#268): one level is drawn at a time. */
  readonly levelId: string;
  /** Layout version (changes with any placement); the nav grid is rebuilt on change. */
  readonly version: number;
  /** Tiles. */
  readonly width: number;
  readonly depth: number;
  readonly outsideDepth: number;
  readonly tileMetres: number;
  readonly rooms: readonly WorldRoom[];
  readonly corridors: readonly TileRect[];
  readonly blastDoor: { readonly x: number; readonly y: number; readonly width: number };
}

const SPECIAL_NAMES: Readonly<Record<SpecialRoomKind, string>> = {
  lobby: "Lobby",
  conference: "War room",
  break_room: "Break room",
  landing: "Lift landing",
};

/**
 * What the server sends for a room this viewer may not enter, as agreed with
 * #270: its id, its level, its grid footprint and `closed: true`, nothing
 * else. The door fields are optional: with them the room shows a sealed
 * blast door, without them solid rock.
 */
export interface ClosedRoomFields {
  operationId: string;
  levelId: string;
  gridX: number;
  gridY: number;
  width: number;
  depth: number;
  closed: true;
  doorSide?: DoorSide;
  doorX?: number;
  doorY?: number;
}

/** True for a published room entry marked closed (the field is #270's; absent means open). */
export function isClosedEntry(entry: object): boolean {
  return (entry as { closed?: unknown }).closed === true;
}

/**
 * The world from the published state, or null until the compound is first
 * published. `enterable` lists the operation ids the viewer may enter (the REST
 * operation list); null while it is loading, when only the special rooms are open.
 */
export function compoundWorld(
  state: Pick<BuildingState, "compound" | "operations"> | null,
  enterable: ReadonlySet<string> | null,
  levelId: string = LOBBY_LEVEL_ID,
): CompoundWorld | null {
  const c = state?.compound;
  if (!state || !c || c.width === 0) return null;
  const m = c.tileMetres;
  const rooms: WorldRoom[] = [];
  const lobby = state.operations[LOBBY_OPERATION_ID];
  for (const s of c.specialRooms) {
    const rect = { x: s.gridX, y: s.gridY, w: s.width, d: s.depth };
    rooms.push({
      id: s.kind === "lobby" ? LOBBY_OPERATION_ID : s.kind,
      kind: s.kind,
      name: SPECIAL_NAMES[s.kind],
      rect,
      doorSide: s.doorSide,
      door: { x: s.doorX, y: s.doorY },
      origin: { x: rect.x * m, z: rect.y * m },
      size: { w: rect.w * m, d: rect.d * m },
      enterable: true,
      closed: false,
      sealed: false,
      buildState: "ready",
      buildEndsAt: 0,
      deskCount: 0,
      decorStyle: "ops_room",
      henchmenWorking: s.kind === "lobby" ? (lobby?.henchmenWorking ?? 0) : 0,
      henchmenWaiting: s.kind === "lobby" ? (lobby?.henchmenWaiting ?? 0) : 0,
      henchmenTotal: s.kind === "lobby" ? (lobby?.henchmenTotal ?? 0) : 0,
    });
  }
  const placed = Object.values(state.operations)
    .filter(
      (f) => f.operationId !== LOBBY_OPERATION_ID && f.gridX >= 0 && f.gridY >= 0 && f.width > 0,
    )
    .sort((a, b) => a.index - b.index);
  for (const f of placed)
    rooms.push(
      isClosedEntry(f)
        ? closedRoom(f, m)
        : projectRoom(f, m, enterable?.has(f.operationId) ?? false),
    );
  return {
    levelId,
    version: c.version,
    width: c.width,
    depth: c.depth,
    outsideDepth: c.outsideDepth,
    tileMetres: m,
    rooms,
    corridors: c.corridors,
    blastDoor: { x: c.blastDoorX, y: c.blastDoorY, width: c.blastDoorWidth },
  };
}

function projectRoom(f: OperationSummary, m: number, enterable: boolean): WorldRoom {
  const rect = { x: f.gridX, y: f.gridY, w: f.width, d: f.depth };
  return {
    id: f.operationId,
    kind: "project",
    name: f.name,
    rect,
    doorSide: f.doorSide,
    door: { x: f.doorX, y: f.doorY },
    origin: { x: rect.x * m, z: rect.y * m },
    size: { w: rect.w * m, d: rect.d * m },
    enterable,
    closed: false,
    sealed: false,
    buildState: f.buildState,
    buildEndsAt: f.buildEndsAt,
    deskCount: Math.max(1, f.deskCount),
    decorStyle: f.decorStyle,
    henchmenWorking: f.henchmenWorking,
    henchmenWaiting: f.henchmenWaiting,
    henchmenTotal: f.henchmenTotal,
  };
}

/**
 * A closed room (#269): the footprint and nothing else. Name, counts, desks,
 * decor and build state are dropped here even if an entry carried them, so
 * nothing downstream (plaques, quick travel, who is where, sounds) can show them.
 */
function closedRoom(
  f: Pick<ClosedRoomFields, "operationId" | "gridX" | "gridY" | "width" | "depth"> &
    Partial<Pick<ClosedRoomFields, "doorSide" | "doorX" | "doorY">>,
  m: number,
): WorldRoom {
  const rect = { x: f.gridX, y: f.gridY, w: f.width, d: f.depth };
  const door = closedRoomDoor(f, rect);
  const doorSide = door?.side ?? "south";
  return {
    id: f.operationId,
    kind: "project",
    name: "",
    rect,
    doorSide,
    door: door ? { x: door.x, y: door.y } : doorStart(rect, doorSide),
    origin: { x: rect.x * m, z: rect.y * m },
    size: { w: rect.w * m, d: rect.d * m },
    enterable: false,
    closed: true,
    sealed: door === null,
    buildState: "ready",
    buildEndsAt: 0,
    deskCount: 1,
    decorStyle: DEFAULT_ROOM_SETTINGS.decorStyle,
    henchmenWorking: 0,
    henchmenWaiting: 0,
    henchmenTotal: 0,
  };
}

/** The door of a closed entry when it names one that lies on that wall of the footprint, else null. */
function closedRoomDoor(
  f: Partial<Pick<ClosedRoomFields, "doorSide" | "doorX" | "doorY">>,
  rect: TileRect,
): { side: DoorSide; x: number; y: number } | null {
  const { doorSide: side, doorX: x, doorY: y } = f;
  if (!side || !(DOOR_SIDES as readonly string[]).includes(side)) return null;
  if (x === undefined || y === undefined) return null;
  const onWall =
    side === "north" || side === "south"
      ? y === (side === "north" ? rect.y : rect.y + rect.d) &&
        x >= rect.x &&
        x + 2 <= rect.x + rect.w
      : x === (side === "west" ? rect.x : rect.x + rect.w) &&
        y >= rect.y &&
        y + 2 <= rect.y + rect.d;
  return onWall ? { side, x, y } : null;
}

/** A room the viewer walks into and sees inside: enterable and finished. */
export function isOpenRoom(room: WorldRoom): boolean {
  return room.enterable && room.buildState === "ready";
}

/** The room whose floor contains the point (metres), or null in a corridor or outside. */
export function roomAt(world: CompoundWorld, x: number, z: number): WorldRoom | null {
  for (const r of world.rooms) {
    if (
      x >= r.origin.x &&
      x < r.origin.x + r.size.w &&
      z >= r.origin.z &&
      z < r.origin.z + r.size.d
    )
      return r;
  }
  return null;
}

export function roomById(world: CompoundWorld, id: string): WorldRoom | undefined {
  return world.rooms.find((r) => r.id === id);
}

/**
 * The OperationRoom the player is "in" (SPEC §9.1): the project room under them,
 * or null in the lobby, the other special rooms, the corridors and outside.
 */
export function currentOperationAt(world: CompoundWorld, x: number, z: number): string | null {
  const room = roomAt(world, x, z);
  return room && room.kind === "project" ? room.id : null;
}

/** Ground distance from a point to a room's footprint (0 inside). */
export function distanceToRoom(room: WorldRoom, x: number, z: number): number {
  const dx = Math.max(room.origin.x - x, 0, x - (room.origin.x + room.size.w));
  const dz = Math.max(room.origin.z - z, 0, z - (room.origin.z + room.size.d));
  return Math.hypot(dx, dz);
}

/** Centre of the doorway on the wall line, metres. */
export function doorCentre(room: WorldRoom, tileMetres: number): { x: number; z: number } {
  const half = tileMetres; // doors are two tiles wide
  const along = room.doorSide === "north" || room.doorSide === "south";
  return {
    x: room.door.x * tileMetres + (along ? half : 0),
    z: room.door.y * tileMetres + (along ? 0 : half),
  };
}

/** Where quick travel puts the player: in the corridor in front of the door, facing in. */
export function travelPose(room: WorldRoom): Pose {
  return doorApproach(room.rect, room.doorSide);
}

/** Point a room's centre, for walking in and for camera framing. */
export function roomCentre(room: WorldRoom): { x: number; z: number } {
  return { x: room.origin.x + room.size.w / 2, z: room.origin.z + room.size.d / 2 };
}

/** The lobby: on the lobby level only (the other levels have a landing, #269). */
export function lobbyOf(world: CompoundWorld): WorldRoom | undefined {
  return world.rooms.find((r) => r.kind === "lobby");
}

/**
 * The room people arrive in on this level, where the lift stands: the lobby
 * on the lobby level, the landing on every other one.
 */
export function arrivalRoomOf(world: CompoundWorld): WorldRoom | undefined {
  return world.rooms.find((r) => r.kind === "lobby" || r.kind === "landing");
}

/** World metres of the whole compound including the beach strip. */
export function worldExtent(world: CompoundWorld): { w: number; d: number } {
  return {
    w: world.width * world.tileMetres,
    d: (world.depth + world.outsideDepth) * world.tileMetres,
  };
}

/**
 * What the overview frames (metres): the built part of the compound (every
 * room and corridor, plus a margin), not the whole empty grid around it.
 */
export function builtBounds(world: CompoundWorld): {
  centre: { x: number; z: number };
  extent: number;
} {
  const m = world.tileMetres;
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  const add = (x: number, z: number, w: number, d: number) => {
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x + w);
    maxZ = Math.max(maxZ, z + d);
  };
  for (const r of world.rooms) add(r.origin.x, r.origin.z, r.size.w, r.size.d);
  for (const c of world.corridors) add(c.x * m, c.y * m, c.w * m, c.d * m);
  if (!Number.isFinite(minX)) {
    const e = worldExtent(world);
    return { centre: { x: e.w / 2, z: e.d / 2 }, extent: Math.max(e.w, e.d) };
  }
  const margin = 4 * m;
  return {
    centre: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    extent: Math.max(maxX - minX, maxZ - minZ) + 2 * margin,
  };
}
