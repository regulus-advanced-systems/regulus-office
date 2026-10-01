/**
 * Boot step of the compound migration (SPEC §9.1 "Migration", #181). The SQL
 * migration only adds the columns; placing rooms needs the layout rules, so
 * it runs here, idempotently, in one write transaction:
 *
 * - No `compound` row yet: create it (OFFICE_COMPOUND_SIZE, lobby on the
 *   south edge) and lay every live operation out as a ready room in rows off the
 *   main corridor, in elevator order, sized by its desk seats. The compound
 *   grows if they do not fit. Repos, members, desks, henchmen and seats are
 *   untouched: they hang off the operation id, which does not change.
 * - Otherwise: reconcile, placing any live operation that has no valid spot
 *   (an operation written without one, or restored onto a built-over spot).
 *
 * Archived operations are placed when they are restored.
 */
import {
  type CompoundSpec,
  compoundSpecProblems,
  defaultCompoundSpec,
  planMigration,
  type ReconcileInput,
  reconcilePlacements,
} from "@regulus/room-layout";
import { asc, isNull } from "drizzle-orm";
import { AUDIT_ACTIONS, type DbOrTx, writeAudit } from "../auth/audit.ts";
import type { Db } from "../db/index.ts";
import { operations } from "../db/schema/index.ts";
import type { Logger } from "../logging.ts";
import { liveRooms, readSpec, sizeForUnplaced, writePlacement, writeSpec } from "./store.ts";

export interface EnsureCompoundResult {
  spec: CompoundSpec;
  /** True when this call created the compound (and migrated the operations). */
  created: boolean;
  /** Operations given a (new) placement. */
  placed: string[];
  /** Live operations that found no spot (compound full); they stay off the map. */
  unplaced: string[];
}

/** Elevator order for migrated operations: the order people knew them in. */
function elevatorOrder(db: DbOrTx): Map<string, number> {
  const rows = db
    .select({ id: operations.id })
    .from(operations)
    .where(isNull(operations.archivedAt))
    .orderBy(asc(operations.index), asc(operations.createdAt), asc(operations.id))
    .all();
  return new Map(rows.map((r, i) => [r.id, i]));
}

/** Place what needs placing; see the module comment. Safe to call on every boot and change. */
export function ensureCompound(
  db: Db,
  options: { sizeTiles: number; logger?: Logger },
): EnsureCompoundResult {
  const result = db.transaction(
    (tx) => {
      const stored = readSpec(tx);
      const rooms = liveRooms(tx);
      const inputs: ReconcileInput[] = rooms.map((room) => ({
        id: room.id,
        placement: room.placement,
        size: sizeForUnplaced(tx, room),
      }));
      let spec: CompoundSpec;
      let plan: ReturnType<typeof reconcilePlacements>;
      if (stored) {
        spec = stored;
        plan = reconcilePlacements(spec, inputs);
      } else {
        const order = elevatorOrder(tx);
        inputs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        const start = defaultCompoundSpec(options.sizeTiles);
        const problems = compoundSpecProblems(start);
        if (problems.length > 0) throw new Error(`invalid compound size: ${problems.join(", ")}`);
        ({ spec, result: plan } = planMigration(start, inputs));
        writeSpec(tx, spec);
      }
      for (const id of plan.changed) {
        const placement = plan.placements.get(id);
        if (placement) writePlacement(tx, id, placement);
      }
      if (!stored || plan.changed.length > 0) {
        writeAudit(tx, {
          userId: null,
          action: stored ? AUDIT_ACTIONS.compoundRoomsPlaced : AUDIT_ACTIONS.compoundCreate,
          targetKind: "compound",
          targetId: "main",
          meta: {
            width: spec.width,
            depth: spec.depth,
            placed: plan.changed,
            unplaced: plan.unplaced,
          },
        });
      }
      return {
        spec,
        created: !stored,
        placed: [...plan.changed],
        unplaced: [...plan.unplaced],
      };
    },
    { behavior: "immediate" },
  );
  if (result.created || result.placed.length > 0) {
    options.logger?.info(
      { width: result.spec.width, depth: result.spec.depth, placed: result.placed.length },
      result.created ? "compound created, operations migrated into rooms" : "rooms placed",
    );
  }
  if (result.unplaced.length > 0) {
    options.logger?.warn({ unplaced: result.unplaced }, "compound full: rooms left off the map");
  }
  return result;
}
