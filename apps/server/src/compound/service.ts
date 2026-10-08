/**
 * The compound on the server (SPEC §9.1, #181): placing new rooms, moving
 * them, checking a placement for build mode, keeping every live room
 * placed, running the build phase, and publishing the layout.
 *
 * Owners and admins build and move rooms; every change is audited. Moving is
 * refused while henchmen run in the room. New rooms are created through the
 * operation service, which calls {@link CompoundService.claim} inside its create
 * transaction; removal is the operation delete (#150).
 *
 * Each level has its own grid of rooms (#268; SPEC D26): a placement is only
 * ever checked against the rooms of its own level, and the layout (corridors)
 * is computed and published per level. The grid's size and the lobby's
 * footprint are the same on every level.
 */

import {
  type CompoundLayoutResponse,
  type CompoundRoomInfo,
  LOBBY_LEVEL_ID,
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
import { levelInfo, shownLevels } from "../levels/store.ts";
import type { Logger } from "../logging.ts";
import {
  isOfficeManager,
  lairViewFor,
  type OperationActor,
  operationAccessFor,
} from "../operations/access.ts";
import { henchmenOn } from "../operations/lifecycle.ts";
import { BuildTimers } from "./build.ts";
import type { CompoundConfig } from "./config.ts";
import { ensureCompound } from "./migrate.ts";
import type { CompoundSnapshot, LevelSnapshot, RoomFields } from "./room-state.ts";
import { liveRooms, type RoomRow, readSpec, roomsOnLevel, writePlacement } from "./store.ts";

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
   * requested placement on the grid of `levelId` (or find one) and audit it.
   * Throws 409 when refused.
   */
  claim(
    tx: DbOrTx,
    actor: OperationActor,
    operationId: string,
    requested: RoomPlacement | undefined,
    deskSeats: number,
    levelId: string,
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

  /**
   * The published shape: every shown level with its own layout, plus each
   * room's placement and build fields (rooms of all levels; the lobby under
   * its fixed id). The lobby level is always there.
   */
  snapshot(): CompoundSnapshot {
    const spec = this.#spec();
    const rooms = liveRooms(this.#db);
    const byId = new Map(rooms.map((r) => [r.id, r]));
    const fields = new Map<string, RoomFields>();
    const levels: LevelSnapshot[] = [];
    let lobbyState: CompoundSnapshot["state"] | undefined;
    for (const level of shownLevels(this.#db)) {
      const layout: CompoundLayout = computeCompoundLayout(
        spec,
        placed(roomsOnLevel(rooms, level.id)),
      );
      const state = compoundStateOf(layout);
      levels.push({ ...levelInfo(level), state });
      if (level.id === LOBBY_LEVEL_ID) {
        lobbyState = state;
        const lobby = layout.specialRooms.find((s) => s.kind === "lobby");
        if (lobby) {
          fields.set(LOBBY_OPERATION_ID, {
            ...roomSummaryPlacement(lobby),
            buildState: "ready",
            buildEndsAt: 0,
          });
        }
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
    }
    return {
      state: lobbyState ?? compoundStateOf(computeCompoundLayout(spec, [])),
      rooms: fields,
      levels,
    };
  }

  publish(): void {
    if (!this.#deps.publish) return;
    try {
      this.#deps.publish(this.snapshot());
    } catch (err) {
      this.#deps.logger.error({ err }, "publishing the compound failed");
    }
  }

  /**
   * `GET /api/compound`: the layout as this person may see it (D26; #270).
   * Levels they reach; on those, the rooms they may enter in full and the
   * others closed (id, level and footprint, nothing else). A level they
   * cannot reach, and its rooms, are not in the answer.
   */
  layoutResponse(actor: OperationActor): CompoundLayoutResponse {
    const view = lairViewFor(this.#db, actor);
    const { state, rooms, levels = [] } = this.snapshot();
    const rows = new Map(liveRooms(this.#db).map((r) => [r.id, r]));
    const list: CompoundRoomInfo[] = [];
    for (const [operationId, f] of rooms) {
      const row = rows.get(operationId);
      if (operationId === LOBBY_OPERATION_ID || !row) continue;
      if (!view.levels.has(row.levelId)) continue;
      const placement = {
        operationId,
        levelId: row.levelId,
        gridX: f.gridX,
        gridY: f.gridY,
        width: f.width,
        depth: f.depth,
        doorSide: f.doorSide,
        doorX: f.doorX,
        doorY: f.doorY,
      };
      list.push(
        view.rooms.has(operationId)
          ? { ...placement, name: row.name, buildState: f.buildState, buildEndsAt: f.buildEndsAt }
          : { ...placement, name: "", buildState: "ready", buildEndsAt: 0, closed: true },
      );
    }
    return {
      compound: state,
      levels: levels
        .filter((level) => view.levels.has(level.levelId))
        .map(({ state: compound, ...level }) => ({ ...level, compound })),
      rooms: list,
    };
  }

  /**
   * Build-mode ghost: would `placement` be valid on a level's grid? Moving a
   * room (`operationId`): its own level, ignoring the room itself. A new room:
   * `levelId`, or the lobby level's grid, which has no project rooms and so
   * equals the grid of a level that does not exist yet.
   */
  check(
    actor: OperationActor,
    placement: RoomPlacement,
    operationId?: string,
    levelId?: string,
  ): PlacementCheckResponse {
    requireManager(actor);
    const rooms = liveRooms(this.#db);
    // A room or level the person cannot see is not there for them (#270): a room
    // that is not theirs is checked like a new one, an unreachable level like
    // the empty grid of a level that does not exist yet. The real placement is
    // checked again, on the real grid, when the room is created or moved.
    const view = lairViewFor(this.#db, actor);
    const moving =
      operationId && view.rooms.has(operationId)
        ? rooms.find((r) => r.id === operationId)
        : undefined;
    const named = levelId !== undefined && view.levels.has(levelId) ? levelId : undefined;
    const level = moving?.levelId ?? named ?? LOBBY_LEVEL_ID;
    const result = checkPlacement(
      this.#spec(),
      placed(roomsOnLevel(rooms, level)),
      moving?.id ?? "new",
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
    levelId: string,
  ): NewRoomColumns {
    requireManager(actor);
    const spec = this.#spec(tx);
    const others = placed(roomsOnLevel(liveRooms(tx), levelId));
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
      meta: { placement, auto: !requested, levelId },
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
    // The office role moves rooms; it does not reach a room of a repo the person cannot see.
    if (!operationAccessFor(this.#db, actor, operationId)) {
      throw new AuthHttpError(404, "operation_not_found");
    }
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
        const onLevel = roomsOnLevel(rooms, room.levelId);
        const result = checkPlacement(spec, placed(onLevel), operationId, placement);
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
    const info = this.layoutResponse(actor).rooms.find((r) => r.operationId === operationId);
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
