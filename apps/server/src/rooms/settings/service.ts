/**
 * Room settings (#182, SPEC §9.1 "Room interiors", D8, D21): a room's desk
 * count and decor style.
 *
 * - Anyone with room access reads them; room managers (`manage`, which
 *   office owners and admins have everywhere) change them. Unknown, archived
 *   or invisible rooms are 404, view/spawn access is 403.
 * - The desk count is bounded by the room's size (`maxDeskCount`) and never
 *   drops below a desk with a henchman at it. Desk rows follow the count in the
 *   same transaction as the check, so a henchman cannot sit down at a desk that
 *   is being removed.
 * - Rooms still drawn from a pre-compound template (`layoutTemplateId` is a
 *   template id, not `room`) may change style but not desk count: the
 *   template cannot draw the extra desks until the scene switches to
 *   generated rooms (#186).
 * - Every change is audited and republished to the room's OperationRoom.
 */

import {
  hasOperationAccess,
  mayManageRoomSettings,
  type OperationAccess,
  ROOM_MAX_TILES,
  ROOM_MIN_TILES,
  type RoomSettingsInfo,
  type RoomShape,
  type UpdateRoomSettingsRequest,
} from "@regulus/protocol";
import {
  canonicalSeatId,
  isLegacyTemplateId,
  maxDeskCount,
  parseRoomSeatId,
  ROOM_LAYOUT_ID,
  roomDeskSeatIds,
} from "@regulus/room-layout";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { AUDIT_ACTIONS, type DbOrTx, writeAudit } from "../../auth/audit.ts";
import { AuthHttpError, forbidden } from "../../auth/errors.ts";
import type { Db } from "../../db/index.ts";
import { desks, operations } from "../../db/schema/index.ts";
import { type OperationActor, operationAccessFor } from "../../operations/access.ts";

export type OperationRow = typeof operations.$inferSelect;

export interface RoomSettingsDeps {
  db: Db;
  /** The room changed: republish its OperationRoom. */
  onChange?(operationId: string): void;
  /** The room's size and door side; default: the compound placement on `operations` (#181). */
  sizeOf?(operation: OperationRow): RoomShape | null;
}

/** A room's shape from its compound placement columns; null when they are out of range. */
export function roomShapeOf(operation: OperationRow): RoomShape | null {
  const ok = (n: number) => Number.isInteger(n) && n >= ROOM_MIN_TILES && n <= ROOM_MAX_TILES;
  if (!ok(operation.width) || !ok(operation.depth)) return null;
  return { width: operation.width, depth: operation.depth, doorSide: operation.doorSide };
}

const notFound = () => new AuthHttpError(404, "operation_not_found");

/** Desk numbers with a henchman at one of their seats, for any of the operation's seat ids. */
function occupiedDesks(db: DbOrTx, operation: OperationRow): number[] {
  const rows = db
    .select({ seatId: desks.seatId, agentId: desks.agentId })
    .from(desks)
    .where(eq(desks.operationId, operation.id))
    .all();
  const numbers = new Set<number>();
  for (const row of rows) {
    if (!row.agentId) continue;
    const seat = parseRoomSeatId(canonicalSeatId(operation.layoutTemplateId, row.seatId));
    if (seat) numbers.add(seat.desk);
  }
  return [...numbers].sort((a, b) => a - b);
}

/**
 * Make a generated room's desk rows match `deskCount`: add the seats of new
 * desks, remove the free seats of dropped desks. Callers check occupancy
 * first; this never removes an occupied seat. Exported for room creation.
 */
export function syncDeskRows(db: DbOrTx, operationId: string, deskCount: number): void {
  const want = roomDeskSeatIds(deskCount);
  const have = db
    .select({ seatId: desks.seatId })
    .from(desks)
    .where(eq(desks.operationId, operationId))
    .all()
    .map((r) => r.seatId);
  const missing = want.filter((id) => !have.includes(id));
  if (missing.length > 0)
    db.insert(desks)
      .values(missing.map((seatId) => ({ operationId, seatId })))
      .run();
  const keep = new Set(want);
  const extra = have.filter((id) => !keep.has(id));
  if (extra.length > 0)
    db.delete(desks)
      .where(
        and(
          eq(desks.operationId, operationId),
          inArray(desks.seatId, extra),
          isNull(desks.agentId),
        ),
      )
      .run();
}

export class RoomSettingsService {
  readonly #deps: RoomSettingsDeps;

  constructor(deps: RoomSettingsDeps) {
    this.#deps = deps;
  }

  #operation(db: DbOrTx, operationId: string): OperationRow {
    const row = db
      .select()
      .from(operations)
      .where(and(eq(operations.id, operationId), isNull(operations.archivedAt)))
      .get();
    if (!row) throw notFound();
    return row;
  }

  #access(actor: OperationActor, operationId: string, need: OperationAccess): OperationAccess {
    const access = operationAccessFor(this.#deps.db, actor, operationId);
    if (!access) throw notFound();
    if (!hasOperationAccess(access, need)) throw forbidden(`operation_${need}_required`);
    return access;
  }

  #info(db: DbOrTx, operation: OperationRow, access: OperationAccess): RoomSettingsInfo {
    const size = (this.#deps.sizeOf ?? roomShapeOf)(operation);
    return {
      operationId: operation.id,
      deskCount: operation.deskCount,
      decorStyle: operation.decorStyle,
      size,
      maxDeskCount: size
        ? Math.max(operation.deskCount, maxDeskCount(size.width, size.depth))
        : operation.deskCount,
      occupiedDesks: occupiedDesks(db, operation),
      generated: operation.layoutTemplateId === ROOM_LAYOUT_ID,
      canManage: mayManageRoomSettings(access),
    };
  }

  get(actor: OperationActor, operationId: string): RoomSettingsInfo {
    const access = this.#access(actor, operationId, "view");
    return this.#info(this.#deps.db, this.#operation(this.#deps.db, operationId), access);
  }

  update(
    actor: OperationActor,
    operationId: string,
    body: UpdateRoomSettingsRequest,
  ): RoomSettingsInfo {
    const access = this.#access(actor, operationId, "manage");
    const db = this.#deps.db;
    const changed = db.transaction(
      (tx) => {
        const operation = this.#operation(tx, operationId);
        const deskCount = body.deskCount ?? operation.deskCount;
        const decorStyle = body.decorStyle ?? operation.decorStyle;
        if (deskCount !== operation.deskCount) this.#checkDeskCount(tx, operation, deskCount);
        if (deskCount === operation.deskCount && decorStyle === operation.decorStyle) return false;
        tx.update(operations)
          .set({ deskCount, decorStyle })
          .where(eq(operations.id, operationId))
          .run();
        if (deskCount !== operation.deskCount) syncDeskRows(tx, operationId, deskCount);
        writeAudit(tx, {
          userId: actor.id,
          action: AUDIT_ACTIONS.operationRoomSettings,
          targetKind: "operation",
          targetId: operationId,
          meta: {
            from: { deskCount: operation.deskCount, decorStyle: operation.decorStyle },
            to: { deskCount, decorStyle },
          },
        });
        return true;
      },
      { behavior: "immediate" },
    );
    if (changed) this.#deps.onChange?.(operationId);
    return this.#info(db, this.#operation(db, operationId), access);
  }

  #checkDeskCount(tx: DbOrTx, operation: OperationRow, deskCount: number): void {
    if (operation.layoutTemplateId !== ROOM_LAYOUT_ID) {
      throw new AuthHttpError(409, "room_not_generated", {
        legacyTemplate: isLegacyTemplateId(operation.layoutTemplateId),
      });
    }
    const size = (this.#deps.sizeOf ?? roomShapeOf)(operation);
    if (!size) throw new AuthHttpError(409, "room_size_unknown");
    const max = maxDeskCount(size.width, size.depth);
    if (deskCount > max) throw new AuthHttpError(400, "too_many_desks", { maxDeskCount: max });
    const occupied = occupiedDesks(tx, operation).filter((n) => n > deskCount);
    if (occupied.length > 0) throw new AuthHttpError(409, "desks_occupied", { desks: occupied });
  }
}
