/**
 * The lair as the office agents' bodies need it (#252): per level, the rooms
 * (footprint in metres, door, whether it is a project room and finished) and
 * the corridors, read from the BuildingRoom state the clients draw from. Pure
 * shapes and maths; no access rules here (world.ts asks `AgentAccess`).
 */
import {
  COMPOUND_TILE_METRES,
  DECOR_STYLES,
  type DecorStyle,
  DOOR_SIDES,
  type DoorSide,
  isOneOf,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  SPECIAL_ROOM_KINDS,
  type SpecialRoomKind,
} from "@regulus/protocol";
import { doorApproach, type Pose, type Rect, type Vec2 } from "@regulus/room-layout";

export type LairRoomKind = "project" | SpecialRoomKind;

export interface LairRoom {
  /** Operation id for project rooms and the lobby; the special room's kind otherwise. */
  id: string;
  kind: LairRoomKind;
  levelId: string;
  /** Footprint, metres. */
  rect: Rect;
  /** Footprint, tiles. */
  tiles: { x: number; y: number; w: number; d: number };
  doorSide: DoorSide;
  /** Built and open (a room still being built is shut). */
  ready: boolean;
  deskCount: number;
  decorStyle: DecorStyle;
}

export interface LairLevel {
  levelId: string;
  rooms: LairRoom[];
  /** Corridor rectangles, metres. */
  corridors: Rect[];
}

export interface Lair {
  /** Changes when the layout or a room's build state does. */
  key: string;
  levels: Map<string, LairLevel>;
}

interface CompoundLike {
  version: number;
  tileMetres: number;
  specialRooms: Iterable<{
    kind: string;
    gridX: number;
    gridY: number;
    width: number;
    depth: number;
    doorSide: string;
  }>;
  corridors: Iterable<{ x: number; y: number; w: number; d: number }>;
}

/** The slice of the BuildingRoom state the lair is read from (schema or plain). */
export interface LairSource {
  compound: CompoundLike;
  levels: { forEach(fn: (level: { levelId: string; compound: CompoundLike }) => void): void };
  operations: {
    forEach(
      fn: (room: {
        operationId: string;
        levelId: string;
        gridX: number;
        gridY: number;
        width: number;
        depth: number;
        doorSide: string;
        buildState: string;
        deskCount: number;
        decorStyle: string;
      }) => void,
    ): void;
  };
}

const isSpecialKind = isOneOf(SPECIAL_ROOM_KINDS);
const isDoorSide = isOneOf(DOOR_SIDES);
const isDecorStyle = isOneOf(DECOR_STYLES);

/** A cheap fingerprint of everything {@link readLair} reads. */
export function lairKey(source: LairSource): string {
  const parts: string[] = [String(source.compound.version)];
  source.levels.forEach((l) => parts.push(`${l.levelId}@${l.compound.version}`));
  source.operations.forEach((r) =>
    parts.push(
      `${r.operationId}:${r.levelId}:${r.gridX},${r.gridY},${r.width},${r.depth}:${r.doorSide}:${r.buildState}:${r.deskCount}:${r.decorStyle}`,
    ),
  );
  return parts.join("|");
}

function levelOf(levelId: string, c: CompoundLike): LairLevel {
  const m = c.tileMetres || COMPOUND_TILE_METRES;
  const rooms: LairRoom[] = [];
  for (const s of c.specialRooms) {
    if (!isSpecialKind(s.kind) || !isDoorSide(s.doorSide)) continue;
    rooms.push({
      id: s.kind === "lobby" ? LOBBY_OPERATION_ID : s.kind,
      kind: s.kind,
      levelId,
      rect: { x: s.gridX * m, z: s.gridY * m, w: s.width * m, d: s.depth * m },
      tiles: { x: s.gridX, y: s.gridY, w: s.width, d: s.depth },
      doorSide: s.doorSide,
      ready: true,
      deskCount: 0,
      decorStyle: "ops_room",
    });
  }
  const corridors: Rect[] = [];
  for (const r of c.corridors) corridors.push({ x: r.x * m, z: r.y * m, w: r.w * m, d: r.d * m });
  return { levelId, rooms, corridors };
}

export function readLair(source: LairSource): Lair {
  const levels = new Map<string, LairLevel>();
  source.levels.forEach((l) => levels.set(l.levelId, levelOf(l.levelId, l.compound)));
  if (!levels.has(LOBBY_LEVEL_ID))
    levels.set(LOBBY_LEVEL_ID, levelOf(LOBBY_LEVEL_ID, source.compound));
  const m = source.compound.tileMetres || COMPOUND_TILE_METRES;
  source.operations.forEach((r) => {
    if (r.operationId === LOBBY_OPERATION_ID || r.gridX < 0 || r.gridY < 0 || r.width <= 0) return;
    if (!isDoorSide(r.doorSide)) return;
    const level = levels.get(r.levelId);
    if (!level) return;
    level.rooms.push({
      id: r.operationId,
      kind: "project",
      levelId: r.levelId,
      rect: { x: r.gridX * m, z: r.gridY * m, w: r.width * m, d: r.depth * m },
      tiles: { x: r.gridX, y: r.gridY, w: r.width, d: r.depth },
      doorSide: r.doorSide,
      ready: r.buildState === "ready",
      deskCount: r.deskCount,
      decorStyle: isDecorStyle(r.decorStyle) ? r.decorStyle : "ops_room",
    });
  });
  return { key: lairKey(source), levels };
}

export const inRect = (r: Rect, p: Vec2, margin = 0): boolean =>
  p.x >= r.x - margin &&
  p.x <= r.x + r.w + margin &&
  p.z >= r.z - margin &&
  p.z <= r.z + r.d + margin;

/** The room whose footprint holds the point, if any. */
export function roomAt(level: LairLevel | undefined, p: Vec2): LairRoom | null {
  return level?.rooms.find((r) => inRect(r.rect, p)) ?? null;
}

/** The corridor rectangle holding the point, if any. */
export function corridorAt(level: LairLevel | undefined, p: Vec2): Rect | null {
  return level?.corridors.find((r) => inRect(r, p)) ?? null;
}

/** The point moved inside the rectangle, `inset` metres clear of its edges. */
export function clampInto(r: Rect, p: Vec2, inset: number): Vec2 {
  const ix = Math.min(inset, r.w / 2);
  const iz = Math.min(inset, r.d / 2);
  return {
    x: Math.min(r.x + r.w - ix, Math.max(r.x + ix, p.x)),
    z: Math.min(r.z + r.d - iz, Math.max(r.z + iz, p.z)),
  };
}

/** Where to stand outside a room's door, facing it (the corridor block in front of it). */
export function doorWait(room: LairRoom): Pose {
  return doorApproach(room.tiles, room.doorSide);
}

/** The lobby of a level (every level has the lobby's footprint: where the lift arrives). */
export function lobbyOf(level: LairLevel | undefined): LairRoom | null {
  return level?.rooms.find((r) => r.kind === "lobby") ?? null;
}

export const centreOf = (r: Rect): Vec2 => ({ x: r.x + r.w / 2, z: r.z + r.d / 2 });
