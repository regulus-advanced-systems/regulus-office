/**
 * The compound on the server (SPEC §9.1, #181): placing new rooms, moving
 * them, checking a placement for build mode, keeping every live room
 * placed, running the build phase, and publishing the layout.
 *
 * Owners and admins build and move rooms; every change is audited. Moving is
 * refused while henchmen run in the room. New rooms are created through the
 * operation service, which calls {@link CompoundService.claim} inside its create
 * transaction; removal is the operation delete (#150).
 */

import {
  type CompoundLayoutResponse,
  type CompoundRoomInfo,
  LOBBY_OPERATION_ID,
  type PlacementCheckResponse,
  type RoomPlacement,
} from "@regulus/protocol";
import {
  type CompoundLayout,
  type CompoundSpec,
  checkPlacement,
  compoundStateOf,
  computeCompoundLayout,
  findPlacement,
  legacyRoomSize,
  roomSummaryPlacement,
  rowSlot,
} from "@regulus/room-layout";
import { AUDIT_ACTIONS, type DbOrTx, writeAudit } from "../auth/audit.ts";
import { AuthHttpError, forbidden } from "../auth/errors.ts";
import type { Db } from "../db/index.ts";
import type { Logger } from "../logging.ts";
import { isOfficeManager, type OperationActor } from "../operations/access.ts";
import { henchmenOn } from "../operations/lifecycle.ts";
import { BuildTimers } from "./build.ts";
import type { CompoundConfig } from "./config.ts";
import { ensureCompound } from "./migrate.ts";
import type { CompoundSnapshot, RoomFields } from "./room-state.ts";
import { liveRooms, type RoomRow, readSpec, writePlacement } from "./store.ts";

/** Placement columns for a new `operations` row. */
export interface NewRoomColumns {
  gridX: number;
  gridY: number;
  width: number;
  depth: number;
  doorSide: RoomPlacement["doorSide"];
  buildState: "building" | "ready";
  buildStartedAt: Date;
}

/** What the operation service needs from the compound when it creates an operation. */
export interface RoomPlacer {
  /**
   * Inside the create transaction, before the row is inserted: check the
   * requested placement (or find one) and audit it. Throws 409 when refused.
   */
  claim(
    tx: DbOrTx,
    actor: OperationActor,
    operationId: string,
    requested: RoomPlacement | undefined,
    deskSeats: number,
  ): NewRoomColumns;
}

export interface CompoundServiceDeps {
  db: Db;
  logger: Logger;
  config: Pick<CompoundConfig, "buildMs" | "sizeTiles">;
  now?: () => number;
  /** The layout or a room's placement/build state changed: publish it. */
  publish?(snapshot: CompoundSnapshot): void;
  /** Rooms whose summary changed outside an operation change (built, moved, re-placed). */
  onRoomsChanged?(operationIds: string[]): void;
}

const requireManager = (actor: OperationActor) => {
  if (!isOfficeManager(actor.role)) throw forbidden("owner_or_admin_required");
};

const placed = (rooms: readonly RoomRow[]) =>
  rooms.flatMap((r) => (r.placement ? [{ id: r.id, placement: r.placement }] : []));

export class CompoundService implements RoomPlacer {
  readonly #deps: CompoundServiceDeps;
  readonly #now: () => number;
  readonly #builds: BuildTimers;

  constructor(deps: CompoundServiceDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? (() => Date.now());
    this.#builds = new BuildTimers({
      db: deps.db,
      logger: deps.logger,
      buildMs: deps.config.buildMs,
      now: this.#now,
      onReady: (operationId) => this.#changed([operationId]),
    });
  }

  get #db() {
    return this.#deps.db;
  }

  /** Boot: create/migrate the compound, resume builds, publish. */
  boot(): ReturnType<typeof ensureCompound> {
    const result = ensureCompound(this.#db, {
      sizeTiles: this.#deps.config.sizeTiles,
      logger: this.#deps.logger,
    });
    this.#builds.sync(liveRooms(this.#db));
    this.publish();
    return result;
  }

  /**
   * An operation was created, archived, restored or deleted (or a repo cloned):
   * place any room that needs it, follow builds, republish.
   */
  operationChanged(_operationId?: string): void {
    const { placed: moved } = ensureCompound(this.#db, {
      sizeTiles: this.#deps.config.sizeTiles,
      logger: this.#deps.logger,
    });
    this.#builds.sync(liveRooms(this.#db));
    this.publish();
    if (moved.length > 0) this.#deps.onRoomsChanged?.(moved);
  }

  #changed(operationIds: string[]): void {
    this.publish();
    this.#deps.onRoomsChanged?.(operationIds);
  }

  #spec(db: DbOrTx = this.#db): CompoundSpec {
    const spec = readSpec(db);
    if (!spec) throw new AuthHttpError(503, "compound_unavailable");
    return spec;
  }

  #buildEndsAt(room: RoomRow): number {
    if (room.buildState !== "building") return 0;
    return this.#builds.endsAt(room.buildStartedAt?.getTime() ?? 0);
  }

  #layout(): { layout: CompoundLayout; rooms: RoomRow[] } {
    const rooms = liveRooms(this.#db);
    return { layout: computeCompoundLayout(this.#spec(), placed(rooms)), rooms };
  }

  /** The published shape: layout state plus each room's placement and build fields. */
  snapshot(): CompoundSnapshot {
    const { layout, rooms } = this.#layout();
    const byId = new Map(rooms.map((r) => [r.id, r]));
    const fields = new Map<string, RoomFields>();
    const lobby = layout.specialRooms.find((s) => s.kind === "lobby");
    if (lobby) {
      fields.set(LOBBY_OPERATION_ID, {
        ...roomSummaryPlacement(lobby),
        buildState: "ready",
        buildEndsAt: 0,
      });
    }
    for (const room of layout.rooms) {
      const row = byId.get(room.id);
      if (!row) continue;
      fields.set(room.id, {
        ...roomSummaryPlacement(room),
        buildState: row.buildState,
        buildEndsAt: this.#buildEndsAt(row),
      });
    }
    return { state: compoundStateOf(layout), rooms: fields };
  }

  publish(): void {
    if (!this.#deps.publish) return;
    try {
      this.#deps.publish(this.snapshot());
    } catch (err) {
      this.#deps.logger.error({ err }, "publishing the compound failed");
    }
  }

  /** `GET /api/compound`: layout and room summaries (any signed-in human). */
  layoutResponse(): CompoundLayoutResponse {
    const { state, rooms } = this.snapshot();
    const names = new Map(liveRooms(this.#db).map((r) => [r.id, r.name]));
    const list: CompoundRoomInfo[] = [];
    for (const [operationId, f] of rooms) {
      if (operationId === LOBBY_OPERATION_ID) continue;
      list.push({
        operationId,
        name: names.get(operationId) ?? "",
        gridX: f.gridX,
        gridY: f.gridY,
        width: f.width,
        depth: f.depth,
        doorSide: f.doorSide,
        doorX: f.doorX,
        doorY: f.doorY,
        buildState: f.buildState,
        buildEndsAt: f.buildEndsAt,
      });
    }
    return { compound: state, rooms: list };
  }

  /** Build-mode ghost: would `placement` be valid (ignoring room `operationId`, when moving it)? */
  check(
    actor: OperationActor,
    placement: RoomPlacement,
    operationId?: string,
  ): PlacementCheckResponse {
    requireManager(actor);
    const result = checkPlacement(
      this.#spec(),
      placed(liveRooms(this.#db)),
      operationId ?? "new",
      placement,
    );
    return result.ok
      ? { ok: true, conflicts: [] }
      : { ok: false, reason: result.reason, conflicts: [...result.conflicts] };
  }

  claim(
    tx: DbOrTx,
    actor: OperationActor,
    operationId: string,
    requested: RoomPlacement | undefined,
    deskSeats: number,
  ): NewRoomColumns {
    requireManager(actor);
    const spec = this.#spec(tx);
    const others = placed(liveRooms(tx));
    let placement: RoomPlacement;
    if (requested) {
      const result = checkPlacement(spec, others, operationId, requested);
      if (!result.ok) {
        throw new AuthHttpError(409, "placement_invalid", {
          reason: result.reason,
          conflicts: result.conflicts,
        });
      }
      placement = requested;
    } else {
      const size = legacyRoomSize(deskSeats);
      const found =
        rowSlot(spec, others, operationId, size) ?? findPlacement(spec, others, operationId, size);
      if (!found) throw new AuthHttpError(409, "compound_full");
      placement = found;
    }
    writeAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.compoundRoomPlace,
      targetKind: "operation",
      targetId: operationId,
      meta: { placement, auto: !requested },
    });
    const instant = this.#deps.config.buildMs <= 0;
    return {
      ...placement,
      buildState: instant ? "ready" : "building",
      buildStartedAt: new Date(this.#now()),
    };
  }

  /** Move and/or resize a room. Refused while any henchman in it is running. */
  move(actor: OperationActor, operationId: string, placement: RoomPlacement): CompoundRoomInfo {
    requireManager(actor);
    this.#db.transaction(
      (tx) => {
        const spec = this.#spec(tx);
        const rooms = liveRooms(tx);
        const room = rooms.find((r) => r.id === operationId);
        if (!room) throw new AuthHttpError(404, "operation_not_found");
        const running = henchmenOn(tx, operationId).filter((r) => r.running);
        if (running.length > 0) {
          throw new AuthHttpError(409, "room_has_running_henchmen", { henchmen: running });
        }
        const result = checkPlacement(spec, placed(rooms), operationId, placement);
        if (!result.ok) {
          throw new AuthHttpError(409, "placement_invalid", {
            reason: result.reason,
            conflicts: result.conflicts,
          });
        }
        writePlacement(tx, operationId, placement);
        writeAudit(tx, {
          userId: actor.id,
          action: AUDIT_ACTIONS.compoundRoomMove,
          targetKind: "operation",
          targetId: operationId,
          meta: { name: room.name, from: room.placement, to: placement },
        });
      },
      { behavior: "immediate" },
    );
    this.#changed([operationId]);
    const info = this.layoutResponse().rooms.find((r) => r.operationId === operationId);
    if (!info) throw new AuthHttpError(404, "operation_not_found");
    return info;
  }

  /** Builds in progress (tests). */
  get pendingBuilds(): number {
    return this.#builds.pending;
  }

  close(): void {
    this.#builds.close();
  }
}
