/**
 * Floor list with per-floor robot counters for the elevator panel (SPEC §6
 * channel 1, §9.1). Counters come from the `agents` table and are zero until
 * M1 spawns robots; `BuildingRoom.refreshFloors()` re-reads them on demand.
 */
import {
  type AgentStatus,
  type FloorSummary,
  LOBBY_FLOOR_ID,
  type RoomSummaryFields,
} from "@regulus/protocol";
import { count, isNull } from "drizzle-orm";
import { agents, type Db, floors } from "../../db/index.ts";

/**
 * Floor rows without the presence counter, which the room computes itself,
 * and without the placement fields, which come from the compound (#181).
 */
export type FloorRecord = Omit<FloorSummary, "humansPresent" | keyof RoomSummaryFields>;

export interface FloorSource {
  /** Every non-archived floor, lobby first, ordered by elevator index. */
  listFloors(): Promise<FloorRecord[]>;
}

/** Robot statuses counted as "working" / "waiting" on the elevator panel. */
export const WORKING_STATUSES: readonly AgentStatus[] = ["working"];
export const WAITING_STATUSES: readonly AgentStatus[] = ["waiting_permission", "waiting_input"];
/** Robots that still exist on the floor (everything but exited/offline). */
export const PRESENT_STATUSES: readonly AgentStatus[] = [
  "starting",
  "idle",
  "working",
  "waiting_permission",
  "waiting_input",
  "done",
  "error",
];

export const LOBBY_FLOOR: FloorRecord = {
  floorId: LOBBY_FLOOR_ID,
  name: "Lobby",
  slug: "lobby",
  index: 0,
  paletteId: "teal-cream",
  robotsWorking: 0,
  robotsWaiting: 0,
  robotsTotal: 0,
};

export class DrizzleFloorSource implements FloorSource {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async listFloors(): Promise<FloorRecord[]> {
    const rows = await this.#db
      .select({
        id: floors.id,
        name: floors.name,
        slug: floors.slug,
        index: floors.index,
        paletteId: floors.paletteId,
      })
      .from(floors)
      .where(isNull(floors.archivedAt))
      .orderBy(floors.index);
    const counts = await this.#db
      .select({ floorId: agents.floorId, status: agents.status, n: count() })
      .from(agents)
      .groupBy(agents.floorId, agents.status);

    const byFloor = new Map<string, { working: number; waiting: number; total: number }>();
    for (const c of counts) {
      const acc = byFloor.get(c.floorId) ?? { working: 0, waiting: 0, total: 0 };
      if (WORKING_STATUSES.includes(c.status)) acc.working += c.n;
      if (WAITING_STATUSES.includes(c.status)) acc.waiting += c.n;
      if (PRESENT_STATUSES.includes(c.status)) acc.total += c.n;
      byFloor.set(c.floorId, acc);
    }

    return [
      LOBBY_FLOOR,
      ...rows.map((row) => {
        const acc = byFloor.get(row.id) ?? { working: 0, waiting: 0, total: 0 };
        return {
          floorId: row.id,
          name: row.name,
          slug: row.slug,
          index: row.index,
          paletteId: row.paletteId,
          robotsWorking: acc.working,
          robotsWaiting: acc.waiting,
          robotsTotal: acc.total,
        };
      }),
    ];
  }
}

/** Fixed list for tests and the load-test script. */
export class StaticFloorSource implements FloorSource {
  floors: FloorRecord[];

  constructor(extra: FloorRecord[] = []) {
    this.floors = [LOBBY_FLOOR, ...extra];
  }

  async listFloors(): Promise<FloorRecord[]> {
    return this.floors;
  }
}

/** True when `floorId` is the lobby or a listed floor; used to validate `floor.go`. */
export function isKnownFloor(floorId: string, known: Iterable<FloorRecord>): boolean {
  if (floorId === LOBBY_FLOOR_ID) return true;
  for (const f of known) if (f.floorId === floorId) return true;
  return false;
}
