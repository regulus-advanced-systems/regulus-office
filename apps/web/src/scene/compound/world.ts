/**
 * The compound as the client sees it (SPEC §9.1, #186): every room of the
 * published layout (the special rooms and the placed project rooms) with its
 * footprint in metres, door, build state, counters and whether this viewer
 * may enter it, plus the corridors. Pure: built from the BuildingRoom state
 * and the REST floor list, then shared by the scene, navigation, presence
 * and quick travel.
 *
 * Coordinates are compound metres (protocol `compound.ts`): x east, z south,
 * origin at the compound's north-west corner; a room's interior is drawn in
 * its own frame with its north-west corner at `origin`.
 */
import { doorApproach, type Pose } from "@regulus/floor-layout";
import {
  type BuildingState,
  type DecorStyle,
  type DoorSide,
  type FloorSummary,
  LOBBY_FLOOR_ID,
  type RoomBuildState,
  type SpecialRoomKind,
  type TileRect,
} from "@regulus/protocol";

export type WorldRoomKind = "project" | SpecialRoomKind;

export interface WorldRoom {
  /** Floor id for project rooms and the lobby; the special room's kind otherwise. */
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
  readonly buildState: RoomBuildState;
  readonly buildEndsAt: number;
  readonly deskCount: number;
  readonly decorStyle: DecorStyle;
  readonly robotsWorking: number;
  readonly robotsWaiting: number;
  readonly robotsTotal: number;
}

export interface CompoundWorld {
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
};

/**
 * The world from the published state, or null until the compound is first
 * published. `enterable` lists the floor ids the viewer may enter (the REST
 * floor list); null while it is loading, when only the special rooms are open.
 */
export function compoundWorld(
  state: Pick<BuildingState, "compound" | "floors"> | null,
  enterable: ReadonlySet<string> | null,
): CompoundWorld | null {
  const c = state?.compound;
  if (!state || !c || c.width === 0) return null;
  const m = c.tileMetres;
  const rooms: WorldRoom[] = [];
  const lobby = state.floors[LOBBY_FLOOR_ID];
  for (const s of c.specialRooms) {
    const rect = { x: s.gridX, y: s.gridY, w: s.width, d: s.depth };
    rooms.push({
      id: s.kind === "lobby" ? LOBBY_FLOOR_ID : s.kind,
      kind: s.kind,
      name: SPECIAL_NAMES[s.kind],
      rect,
      doorSide: s.doorSide,
      door: { x: s.doorX, y: s.doorY },
      origin: { x: rect.x * m, z: rect.y * m },
      size: { w: rect.w * m, d: rect.d * m },
      enterable: true,
      buildState: "ready",
      buildEndsAt: 0,
      deskCount: 0,
      decorStyle: "ops_room",
      robotsWorking: s.kind === "lobby" ? (lobby?.robotsWorking ?? 0) : 0,
      robotsWaiting: s.kind === "lobby" ? (lobby?.robotsWaiting ?? 0) : 0,
      robotsTotal: s.kind === "lobby" ? (lobby?.robotsTotal ?? 0) : 0,
    });
  }
  const placed = Object.values(state.floors)
    .filter((f) => f.floorId !== LOBBY_FLOOR_ID && f.gridX >= 0 && f.gridY >= 0 && f.width > 0)
    .sort((a, b) => a.index - b.index);
  for (const f of placed) rooms.push(projectRoom(f, m, enterable?.has(f.floorId) ?? false));
  return {
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

function projectRoom(f: FloorSummary, m: number, enterable: boolean): WorldRoom {
  const rect = { x: f.gridX, y: f.gridY, w: f.width, d: f.depth };
  return {
    id: f.floorId,
    kind: "project",
    name: f.name,
    rect,
    doorSide: f.doorSide,
    door: { x: f.doorX, y: f.doorY },
    origin: { x: rect.x * m, z: rect.y * m },
    size: { w: rect.w * m, d: rect.d * m },
    enterable,
    buildState: f.buildState,
    buildEndsAt: f.buildEndsAt,
    deskCount: Math.max(1, f.deskCount),
    decorStyle: f.decorStyle,
    robotsWorking: f.robotsWorking,
    robotsWaiting: f.robotsWaiting,
    robotsTotal: f.robotsTotal,
  };
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
 * The FloorRoom the player is "in" (SPEC §9.1): the project room under them,
 * or null in the lobby, the other special rooms, the corridors and outside.
 */
export function currentFloorAt(world: CompoundWorld, x: number, z: number): string | null {
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

/** The lobby (the compound always has one once published). */
export function lobbyOf(world: CompoundWorld): WorldRoom | undefined {
  return world.rooms.find((r) => r.kind === "lobby");
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
