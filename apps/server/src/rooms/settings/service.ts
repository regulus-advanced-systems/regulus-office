/**
 * Room settings (#182, SPEC §9.1 "Room interiors", D8, D21): a room's desk
 * count and decor style.
 *
 * - Anyone with room access reads them; room managers (`manage`, which
 *   office owners and admins have everywhere) change them. Unknown, archived
 *   or invisible rooms are 404, view/spawn access is 403.
 * - The desk count is bounded by the room's size (`maxDeskCount`) and never
 *   drops below a desk with a robot at it. Desk rows follow the count in the
 *   same transaction as the check, so a robot cannot sit down at a desk that
 *   is being removed.
 * - Rooms still drawn from a pre-compound template (`layoutTemplateId` is a
 *   template id, not `room`) may change style but not desk count: the
 *   template cannot draw the extra desks until the scene switches to
 *   generated rooms (#186).
 * - Every change is audited and republished to the room's FloorRoom.
 */
import {
  canonicalSeatId,
  isLegacyTemplateId,
  maxDeskCount,
  parseRoomSeatId,
  ROOM_LAYOUT_ID,
  roomDeskSeatIds,
} from "@regulus/room-layout";
import {
  type FloorAccess,
  hasFloorAccess,
  mayManageRoomSettings,
  ROOM_MAX_TILES,
  ROOM_MIN_TILES,
  type RoomSettingsInfo,
  type RoomShape,
  type UpdateRoomSettingsRequest,
} from "@regulus/protocol";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { AUDIT_ACTIONS, type DbOrTx, writeAudit } from "../../auth/audit.ts";
import { AuthHttpError, forbidden } from "../../auth/errors.ts";
import type { Db } from "../../db/index.ts";
import { desks, floors } from "../../db/schema/index.ts";
import { type FloorActor, floorAccessFor } from "../../floors/access.ts";

export type FloorRow = typeof floors.$inferSelect;

export interface RoomSettingsDeps {
  db: Db;
  /** The room changed: republish its FloorRoom. */
  onChange?(floorId: string): void;
  /** The room's size and door side; default: the compound placement on `floors` (#181). */
  sizeOf?(floor: FloorRow): RoomShape | null;
}

/** A room's shape from its compound placement columns; null when they are out of range. */
export function roomShapeOf(floor: FloorRow): RoomShape | null {
  const ok = (n: number) => Number.isInteger(n) && n >= ROOM_MIN_TILES && n <= ROOM_MAX_TILES;
  if (!ok(floor.width) || !ok(floor.depth)) return null;
  return { width: floor.width, depth: floor.depth, doorSide: floor.doorSide };
}

const notFound = () => new AuthHttpError(404, "floor_not_found");

/** Desk numbers with a robot at one of their seats, for any of the floor's seat ids. */
function occupiedDesks(db: DbOrTx, floor: FloorRow): number[] {
  const rows = db
    .select({ seatId: desks.seatId, agentId: desks.agentId })
    .from(desks)
    .where(eq(desks.floorId, floor.id))
    .all();
  const numbers = new Set<number>();
  for (const row of rows) {
    if (!row.agentId) continue;
    const seat = parseRoomSeatId(canonicalSeatId(floor.layoutTemplateId, row.seatId));
    if (seat) numbers.add(seat.desk);
  }
  return [...numbers].sort((a, b) => a - b);
}

/**
 * Make a generated room's desk rows match `deskCount`: add the seats of new
 * desks, remove the free seats of dropped desks. Callers check occupancy
 * first; this never removes an occupied seat. Exported for room creation.
 */
export function syncDeskRows(db: DbOrTx, floorId: string, deskCount: number): void {
  const want = roomDeskSeatIds(deskCount);
  const have = db
    .select({ seatId: desks.seatId })
    .from(desks)
    .where(eq(desks.floorId, floorId))
    .all()
    .map((r) => r.seatId);
  const missing = want.filter((id) => !have.includes(id));
  if (missing.length > 0)
    db.insert(desks)
      .values(missing.map((seatId) => ({ floorId, seatId })))
      .run();
  const keep = new Set(want);
  const extra = have.filter((id) => !keep.has(id));
  if (extra.length > 0)
    db.delete(desks)
      .where(and(eq(desks.floorId, floorId), inArray(desks.seatId, extra), isNull(desks.agentId)))
      .run();
}

export class RoomSettingsService {
  readonly #deps: RoomSettingsDeps;

  constructor(deps: RoomSettingsDeps) {
    this.#deps = deps;
  }

  #floor(db: DbOrTx, floorId: string): FloorRow {
    const row = db
      .select()
      .from(floors)
      .where(and(eq(floors.id, floorId), isNull(floors.archivedAt)))
      .get();
    if (!row) throw notFound();
    return row;
  }

  #access(actor: FloorActor, floorId: string, need: FloorAccess): FloorAccess {
    const access = floorAccessFor(this.#deps.db, actor, floorId);
    if (!access) throw notFound();
    if (!hasFloorAccess(access, need)) throw forbidden(`floor_${need}_required`);
    return access;
  }

  #info(db: DbOrTx, floor: FloorRow, access: FloorAccess): RoomSettingsInfo {
    const size = (this.#deps.sizeOf ?? roomShapeOf)(floor);
    return {
      floorId: floor.id,
      deskCount: floor.deskCount,
      decorStyle: floor.decorStyle,
      size,
      maxDeskCount: size
        ? Math.max(floor.deskCount, maxDeskCount(size.width, size.depth))
        : floor.deskCount,
      occupiedDesks: occupiedDesks(db, floor),
      generated: floor.layoutTemplateId === ROOM_LAYOUT_ID,
      canManage: mayManageRoomSettings(access),
    };
  }

  get(actor: FloorActor, floorId: string): RoomSettingsInfo {
    const access = this.#access(actor, floorId, "view");
    return this.#info(this.#deps.db, this.#floor(this.#deps.db, floorId), access);
  }

  update(actor: FloorActor, floorId: string, body: UpdateRoomSettingsRequest): RoomSettingsInfo {
    const access = this.#access(actor, floorId, "manage");
    const db = this.#deps.db;
    const changed = db.transaction(
      (tx) => {
        const floor = this.#floor(tx, floorId);
        const deskCount = body.deskCount ?? floor.deskCount;
        const decorStyle = body.decorStyle ?? floor.decorStyle;
        if (deskCount !== floor.deskCount) this.#checkDeskCount(tx, floor, deskCount);
        if (deskCount === floor.deskCount && decorStyle === floor.decorStyle) return false;
        tx.update(floors).set({ deskCount, decorStyle }).where(eq(floors.id, floorId)).run();
        if (deskCount !== floor.deskCount) syncDeskRows(tx, floorId, deskCount);
        writeAudit(tx, {
          userId: actor.id,
          action: AUDIT_ACTIONS.floorRoomSettings,
          targetKind: "floor",
          targetId: floorId,
          meta: {
            from: { deskCount: floor.deskCount, decorStyle: floor.decorStyle },
            to: { deskCount, decorStyle },
          },
        });
        return true;
      },
      { behavior: "immediate" },
    );
    if (changed) this.#deps.onChange?.(floorId);
    return this.#info(db, this.#floor(db, floorId), access);
  }

  #checkDeskCount(tx: DbOrTx, floor: FloorRow, deskCount: number): void {
    if (floor.layoutTemplateId !== ROOM_LAYOUT_ID) {
      throw new AuthHttpError(409, "room_not_generated", {
        legacyTemplate: isLegacyTemplateId(floor.layoutTemplateId),
      });
    }
    const size = (this.#deps.sizeOf ?? roomShapeOf)(floor);
    if (!size) throw new AuthHttpError(409, "room_size_unknown");
    const max = maxDeskCount(size.width, size.depth);
    if (deskCount > max) throw new AuthHttpError(400, "too_many_desks", { maxDeskCount: max });
    const occupied = occupiedDesks(tx, floor).filter((n) => n > deskCount);
    if (occupied.length > 0) throw new AuthHttpError(409, "desks_occupied", { desks: occupied });
  }
}
