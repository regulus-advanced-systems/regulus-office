/**
 * Operation list with per-operation henchman counters for the elevator panel (SPEC §6
 * channel 1, §9.1). Counters come from the `agents` table and are zero until
 * M1 spawns henchmen; `BuildingRoom.refreshOperations()` re-reads them on demand.
 */
import {
  type AgentStatus,
  HOLDING_LEVEL_ID,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  type OperationSummary,
  type OperationSummarySchema,
  type RoomSummaryFields,
} from "@regulus/protocol";
import { count, isNull } from "drizzle-orm";
import { agents, type Db, operations } from "../../db/index.ts";

/**
 * Operation rows without the presence counter, which the room computes itself,
 * and without the placement fields, which come from the compound (#181).
 */
export type OperationRecord = Omit<
  OperationSummary,
  "humansPresent" | "levelId" | keyof RoomSummaryFields
> & {
  /** The room's level (#268); a record without one is shown on the holding level. */
  levelId?: string;
};

export interface OperationSource {
  /** Every non-archived operation, lobby first, ordered by elevator index. */
  listOperations(): Promise<OperationRecord[]>;
}

/** Henchman statuses counted as "working" / "waiting" on the elevator panel. */
export const WORKING_STATUSES: readonly AgentStatus[] = ["working"];
export const WAITING_STATUSES: readonly AgentStatus[] = ["waiting_permission", "waiting_input"];
/** Henchmen that still exist on the operation (everything but exited/offline). */
export const PRESENT_STATUSES: readonly AgentStatus[] = [
  "starting",
  "idle",
  "working",
  "waiting_permission",
  "waiting_input",
  "done",
  "error",
];

export const LOBBY_OPERATION: OperationRecord = {
  operationId: LOBBY_OPERATION_ID,
  levelId: LOBBY_LEVEL_ID,
  name: "Lobby",
  slug: "lobby",
  index: 0,
  paletteId: "teal-cream",
  henchmenWorking: 0,
  henchmenWaiting: 0,
  henchmenTotal: 0,
  deskCount: 0,
  decorStyle: "ops_room",
};

export class DrizzleOperationSource implements OperationSource {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async listOperations(): Promise<OperationRecord[]> {
    const rows = await this.#db
      .select({
        id: operations.id,
        levelId: operations.levelId,
        name: operations.name,
        slug: operations.slug,
        index: operations.index,
        paletteId: operations.paletteId,
        deskCount: operations.deskCount,
        decorStyle: operations.decorStyle,
      })
      .from(operations)
      .where(isNull(operations.archivedAt))
      .orderBy(operations.index);
    const counts = await this.#db
      .select({ operationId: agents.operationId, status: agents.status, n: count() })
      .from(agents)
      .groupBy(agents.operationId, agents.status);

    const byOperation = new Map<string, { working: number; waiting: number; total: number }>();
    for (const c of counts) {
      const acc = byOperation.get(c.operationId) ?? { working: 0, waiting: 0, total: 0 };
      if (WORKING_STATUSES.includes(c.status)) acc.working += c.n;
      if (WAITING_STATUSES.includes(c.status)) acc.waiting += c.n;
      if (PRESENT_STATUSES.includes(c.status)) acc.total += c.n;
      byOperation.set(c.operationId, acc);
    }

    return [
      LOBBY_OPERATION,
      ...rows.map((row) => {
        const acc = byOperation.get(row.id) ?? { working: 0, waiting: 0, total: 0 };
        return {
          operationId: row.id,
          levelId: row.levelId,
          name: row.name,
          slug: row.slug,
          index: row.index,
          paletteId: row.paletteId,
          henchmenWorking: acc.working,
          henchmenWaiting: acc.waiting,
          henchmenTotal: acc.total,
          deskCount: row.deskCount,
          decorStyle: row.decorStyle,
        };
      }),
    ];
  }
}

/** Fixed list for tests and the load-test script. */
export class StaticOperationSource implements OperationSource {
  operations: OperationRecord[];

  constructor(extra: OperationRecord[] = []) {
    this.operations = [LOBBY_OPERATION, ...extra];
  }

  async listOperations(): Promise<OperationRecord[]> {
    return this.operations;
  }
}

/** True when `operationId` is the lobby or a listed operation; used to validate `operation.go`. */
export function isKnownOperation(operationId: string, known: Iterable<OperationRecord>): boolean {
  if (operationId === LOBBY_OPERATION_ID) return true;
  for (const f of known) if (f.operationId === operationId) return true;
  return false;
}

/** Copy a record into its `BuildingState.operations` entry, touching only what changed. */
export function applyOperationRecord(
  entry: InstanceType<typeof OperationSummarySchema>,
  f: OperationRecord,
): void {
  entry.operationId = f.operationId;
  const levelId = f.levelId ?? HOLDING_LEVEL_ID;
  if (entry.levelId !== levelId) entry.levelId = levelId;
  entry.name = f.name;
  entry.slug = f.slug;
  entry.index = f.index;
  entry.paletteId = f.paletteId;
  entry.henchmenWorking = f.henchmenWorking;
  entry.henchmenWaiting = f.henchmenWaiting;
  entry.henchmenTotal = f.henchmenTotal;
  if (entry.deskCount !== f.deskCount) entry.deskCount = f.deskCount;
  if (entry.decorStyle !== f.decorStyle) entry.decorStyle = f.decorStyle;
}
