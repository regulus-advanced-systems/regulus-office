/**
 * Compound rows (SPEC §5): the single `compound` row and the placement
 * columns of live floors. Everything that reads or writes placements goes
 * through here so the column ↔ {@link RoomPlacement} mapping lives in one place.
 */
import { type CompoundSpec, legacyRoomSize } from "@regulus/room-layout";
import type { RoomBuildState, RoomPlacement } from "@regulus/protocol";
import { asc, count, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "../auth/audit.ts";
import { compound, desks, floors } from "../db/schema/index.ts";

export const COMPOUND_ROW_ID = "main";

export interface RoomRow {
  id: string;
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

/** Live (non-archived) floors with their placement, oldest first (placement priority). */
export function liveRooms(db: DbOrTx): RoomRow[] {
  return db
    .select({
      id: floors.id,
      name: floors.name,
      gridX: floors.gridX,
      gridY: floors.gridY,
      width: floors.width,
      depth: floors.depth,
      doorSide: floors.doorSide,
      buildState: floors.buildState,
      buildStartedAt: floors.buildStartedAt,
      createdAt: floors.createdAt,
      index: floors.index,
    })
    .from(floors)
    .where(isNull(floors.archivedAt))
    .orderBy(asc(floors.createdAt), asc(floors.index), asc(floors.id))
    .all()
    .map((r) => ({
      id: r.id,
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

export function writePlacement(db: DbOrTx, floorId: string, p: RoomPlacement): void {
  db.update(floors)
    .set({ gridX: p.gridX, gridY: p.gridY, width: p.width, depth: p.depth, doorSide: p.doorSide })
    .where(eq(floors.id, floorId))
    .run();
}

/**
 * The size a room gets when it has to be placed anew: its stored size if it
 * was ever placed, else (a pre-compound floor) one that fits its desk seats.
 */
export function sizeForUnplaced(db: DbOrTx, room: RoomRow): { width: number; depth: number } {
  if (room.placement) return { width: room.width, depth: room.depth };
  const [row] = db.select({ n: count() }).from(desks).where(eq(desks.floorId, room.id)).all();
  return legacyRoomSize(row?.n ?? 0);
}
