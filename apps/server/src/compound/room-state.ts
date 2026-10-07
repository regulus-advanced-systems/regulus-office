/**
 * Copies the compound snapshot into the BuildingRoom state (SPEC §9.1
 * "Presence and state"): `compound` (grid, special rooms, corridors, blast
 * door) and the placement and build fields of each `operations` entry. The
 * layout is only rewritten when its version changes, so unchanged layouts
 * cost no patches.
 */
import {
  type CompoundState,
  type CompoundStateSchema,
  type LevelInfo,
  LevelStateSchema,
  LOBBY_LEVEL_ID,
  type OperationSummarySchema,
  type RoomSummaryFields,
  SpecialRoomStateSchema,
  TileRectSchema,
  UNPLACED_ROOM,
} from "@regulus/protocol";

/** The placement and build fields of one `OperationSummary`. */
export type RoomFields = RoomSummaryFields;

/** One level and its own layout (#268). */
export interface LevelSnapshot extends LevelInfo {
  state: CompoundState;
}

export interface CompoundSnapshot {
  /** The lobby level's layout. */
  state: CompoundState;
  /**
   * By operation id, across all levels; the lobby under its fixed id. Rooms
   * not listed are not placed.
   */
  rooms: ReadonlyMap<string, RoomFields>;
  /** Every shown level, lobby first; absent = only the lobby level, with `state`. */
  levels?: readonly LevelSnapshot[];
}

/** The levels of a snapshot (see {@link CompoundSnapshot.levels}). */
export function snapshotLevels(snapshot: CompoundSnapshot): readonly LevelSnapshot[] {
  return (
    snapshot.levels ?? [
      {
        levelId: LOBBY_LEVEL_ID,
        kind: "lobby",
        login: "",
        name: "Lobby",
        order: 0,
        state: snapshot.state,
      },
    ]
  );
}

/** Fields of an operation that has no placement yet (briefly, at boot). */
export const UNPLACED: RoomFields = UNPLACED_ROOM;

type CompoundTarget = InstanceType<typeof CompoundStateSchema>;
type OperationTarget = InstanceType<typeof OperationSummarySchema>;

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

type LevelsTarget = {
  get(id: string): InstanceType<typeof LevelStateSchema> | undefined;
  set(id: string, value: InstanceType<typeof LevelStateSchema>): unknown;
  delete(id: string): unknown;
  keys(): IterableIterator<string>;
};

/** Mirror the snapshot's levels into `BuildingState.levels`, touching only what changed. */
export function applyLevels(target: LevelsTarget, snapshot: CompoundSnapshot): void {
  const levels = snapshotLevels(snapshot);
  const seen = new Set(levels.map((l) => l.levelId));
  for (const id of [...target.keys()]) if (!seen.has(id)) target.delete(id);
  for (const level of levels) {
    const existing = target.get(level.levelId);
    const entry = existing ?? new LevelStateSchema();
    if (entry.levelId !== level.levelId) entry.levelId = level.levelId;
    if (entry.kind !== level.kind) entry.kind = level.kind;
    if (entry.login !== level.login) entry.login = level.login;
    if (entry.name !== level.name) entry.name = level.name;
    if (entry.order !== level.order) entry.order = level.order;
    applyCompoundState(entry.compound, level.state);
    if (!existing) target.set(level.levelId, entry);
  }
}

/** Set an operation entry's placement fields, touching only those that changed. */
export function applyRoomFields(entry: OperationTarget, fields: RoomFields = UNPLACED): void {
  const target = entry as unknown as Record<keyof RoomFields, unknown>;
  for (const key of Object.keys(fields) as Array<keyof RoomFields>) {
    if (target[key] !== fields[key]) target[key] = fields[key];
  }
}
