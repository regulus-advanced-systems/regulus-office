/**
 * Copies the compound snapshot into the BuildingRoom state (SPEC §9.1
 * "Presence and state"): `compound` (grid, special rooms, corridors, blast
 * door) and the placement and build fields of each `floors` entry. The
 * layout is only rewritten when its version changes, so unchanged layouts
 * cost no patches.
 */
import {
  type CompoundState,
  type CompoundStateSchema,
  type FloorSummarySchema,
  type RoomSummaryFields,
  SpecialRoomStateSchema,
  TileRectSchema,
  UNPLACED_ROOM,
} from "@regulus/protocol";

/** The placement and build fields of one `FloorSummary`. */
export type RoomFields = RoomSummaryFields;

export interface CompoundSnapshot {
  state: CompoundState;
  /** By floor id; the lobby under its fixed id. Rooms not listed are not placed. */
  rooms: ReadonlyMap<string, RoomFields>;
}

/** Fields of a floor that has no placement yet (briefly, at boot). */
export const UNPLACED: RoomFields = UNPLACED_ROOM;

type CompoundTarget = InstanceType<typeof CompoundStateSchema>;
type FloorTarget = InstanceType<typeof FloorSummarySchema>;

export function applyCompoundState(target: CompoundTarget, state: CompoundState): void {
  if (target.version === state.version && target.width === state.width) return;
  target.width = state.width;
  target.depth = state.depth;
  target.tileMetres = state.tileMetres;
  target.outsideDepth = state.outsideDepth;
  target.blastDoorX = state.blastDoorX;
  target.blastDoorY = state.blastDoorY;
  target.blastDoorWidth = state.blastDoorWidth;
  target.specialRooms.clear();
  for (const s of state.specialRooms) {
    const room = new SpecialRoomStateSchema();
    room.kind = s.kind;
    room.gridX = s.gridX;
    room.gridY = s.gridY;
    room.width = s.width;
    room.depth = s.depth;
    room.doorSide = s.doorSide;
    room.doorX = s.doorX;
    room.doorY = s.doorY;
    target.specialRooms.push(room);
  }
  target.corridors.clear();
  for (const c of state.corridors) {
    const rect = new TileRectSchema();
    rect.x = c.x;
    rect.y = c.y;
    rect.w = c.w;
    rect.d = c.d;
    target.corridors.push(rect);
  }
  target.version = state.version;
}

/** Set a floor entry's placement fields, touching only those that changed. */
export function applyRoomFields(entry: FloorTarget, fields: RoomFields = UNPLACED): void {
  const target = entry as unknown as Record<keyof RoomFields, unknown>;
  for (const key of Object.keys(fields) as Array<keyof RoomFields>) {
    if (target[key] !== fields[key]) target[key] = fields[key];
  }
}
