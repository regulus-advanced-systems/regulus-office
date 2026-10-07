/**
 * Compound rows (SPEC §5): the single `compound` row (the grid's size and the
 * lobby's footprint, the same on every level, #268) and the placement
 * columns of live operations. Each level has its own grid of rooms, so
 * placements are only ever compared within one level ({@link roomsOnLevel}). Everything that reads or writes placements goes
 * through here so the column ↔ {@link RoomPlacement} mapping lives in one place.
 */

import type { RoomBuildState, RoomPlacement } from "@regulus/protocol";
import { type CompoundSpec, legacyRoomSize } from "@regulus/room-layout";
import { asc, count, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "../auth/audit.ts";
import { compound, desks, operations } from "../db/schema/index.ts";

export const COMPOUND_ROW_ID = "main";

export interface RoomRow {
  id: string;
  /** The level whose grid the room is on. */
  levelId: string;
  name: string;
  placement: RoomPlacement | null;
  width: number;
  depth: number;
  doorSide: RoomPlacement["doorSide"];
  buildState: RoomBuildState;
  buildStartedAt: Date | null;
  createdAt: Date;
}

export function readSpec(db: DbOrTx): CompoundSpec | null {
  const row = db.select().from(compound).where(eq(compound.id, COMPOUND_ROW_ID)).get();
  if (!row) return null;
  return {
    width: row.width,
    depth: row.depth,
    lobby: { x: row.lobbyGridX, y: row.lobbyGridY, w: row.lobbyWidth, d: row.lobbyDepth },
  };
}

export function writeSpec(db: DbOrTx, spec: CompoundSpec): void {
  const values = {
    width: spec.width,
    depth: spec.depth,
    lobbyGridX: spec.lobby.x,
    lobbyGridY: spec.lobby.y,
    lobbyWidth: spec.lobby.w,
    lobbyDepth: spec.lobby.d,
  };
  db.insert(compound)
    .values({ id: COMPOUND_ROW_ID, ...values })
    .onConflictDoUpdate({ target: compound.id, set: values })
    .run();
}

/** Live (non-archived) operations with their placement, oldest first (placement priority). */
export function liveRooms(db: DbOrTx): RoomRow[] {
  return db
    .select({
      id: operations.id,
      levelId: operations.levelId,
      name: operations.name,
      gridX: operations.gridX,
      gridY: operations.gridY,
      width: operations.width,
      depth: operations.depth,
      doorSide: operations.doorSide,
      buildState: operations.buildState,
      buildStartedAt: operations.buildStartedAt,
      createdAt: operations.createdAt,
      index: operations.index,
    })
    .from(operations)
    .where(isNull(operations.archivedAt))
    .orderBy(asc(operations.createdAt), asc(operations.index), asc(operations.id))
    .all()
    .map((r) => ({
      id: r.id,
      levelId: r.levelId,
      name: r.name,
      placement:
        r.gridX === null || r.gridY === null
          ? null
          : {
              gridX: r.gridX,
              gridY: r.gridY,
              width: r.width,
              depth: r.depth,
              doorSide: r.doorSide,
            },
      width: r.width,
      depth: r.depth,
      doorSide: r.doorSide,
      buildState: r.buildState,
      buildStartedAt: r.buildStartedAt,
      createdAt: r.createdAt,
    }));
}

/** The rooms of one level, in the order given. */
export function roomsOnLevel(rooms: readonly RoomRow[], levelId: string): RoomRow[] {
  return rooms.filter((r) => r.levelId === levelId);
}

/** Rooms grouped by level, each group in the order given. */
export function roomsByLevel(rooms: readonly RoomRow[]): Map<string, RoomRow[]> {
  const out = new Map<string, RoomRow[]>();
  for (const room of rooms) {
    const list = out.get(room.levelId);
    if (list) list.push(room);
    else out.set(room.levelId, [room]);
  }
  return out;
}

export function writePlacement(db: DbOrTx, operationId: string, p: RoomPlacement): void {
  db.update(operations)
    .set({ gridX: p.gridX, gridY: p.gridY, width: p.width, depth: p.depth, doorSide: p.doorSide })
    .where(eq(operations.id, operationId))
    .run();
}

/**
 * The size a room gets when it has to be placed anew: its stored size if it
 * was ever placed, else (a pre-compound operation) one that fits its desk seats.
 */
export function sizeForUnplaced(db: DbOrTx, room: RoomRow): { width: number; depth: number } {
  if (room.placement) return { width: room.width, depth: room.depth };
  const [row] = db.select({ n: count() }).from(desks).where(eq(desks.operationId, room.id)).all();
  return legacyRoomSize(row?.n ?? 0);
}
