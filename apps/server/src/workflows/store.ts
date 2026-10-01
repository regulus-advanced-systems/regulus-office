/**
 * Workflow definitions in the office DB (#155). The spec (trigger, filters,
 * henchman, actions, limits) is one JSON column validated with the protocol
 * schema on every read, so a row written by an older version still parses
 * (defaults fill new fields) and a broken row is never acted on.
 */
import {
  WorkflowInput,
  type WorkflowSpec,
  type WorkflowUsageToday,
  type WorkflowView,
} from "@regulus/protocol";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { workflows } from "../db/schema/index.ts";

export type WorkflowRow = typeof workflows.$inferSelect;

export interface StoredWorkflow {
  id: string;
  operationId: string;
  spec: WorkflowSpec;
  lastScheduledAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export function parseSpec(
  row: Pick<WorkflowRow, "name" | "enabled" | "specJson">,
): WorkflowSpec | null {
  let raw: unknown;
  try {
    raw = JSON.parse(row.specJson);
  } catch {
    return null;
  }
  const parsed = WorkflowInput.safeParse({
    ...(raw && typeof raw === "object" ? raw : {}),
    name: row.name,
    enabled: row.enabled,
  });
  return parsed.success ? parsed.data : null;
}

function toStored(row: WorkflowRow): StoredWorkflow | null {
  const spec = parseSpec(row);
  if (!spec) return null;
  return {
    id: row.id,
    operationId: row.operationId,
    spec,
    lastScheduledAt: row.lastScheduledAt?.getTime() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function specJson(spec: WorkflowSpec): string {
  const { name: _name, enabled: _enabled, ...rest } = spec;
  return JSON.stringify(rest);
}

export function toView(w: StoredWorkflow, today: WorkflowUsageToday): WorkflowView {
  return {
    ...w.spec,
    id: w.id,
    operationId: w.operationId,
    createdBy: w.createdBy,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    today,
  };
}

export class WorkflowStore {
  constructor(private readonly db: Db) {}

  get(id: string): StoredWorkflow | null {
    const row = this.db.select().from(workflows).where(eq(workflows.id, id)).get();
    return row ? toStored(row) : null;
  }

  listForOperation(operationId: string): StoredWorkflow[] {
    return this.db
      .select()
      .from(workflows)
      .where(eq(workflows.operationId, operationId))
      .orderBy(asc(workflows.createdAt))
      .all()
      .map(toStored)
      .filter((w): w is StoredWorkflow => w !== null);
  }

  /** Enabled workflows of these operations (the engine's candidates for one event). */
  enabledOn(operationIds: readonly string[]): StoredWorkflow[] {
    if (operationIds.length === 0) return [];
    return operationIds.flatMap((operationId) =>
      this.db
        .select()
        .from(workflows)
        .where(and(eq(workflows.operationId, operationId), eq(workflows.enabled, true)))
        .all()
        .map(toStored)
        .filter((w): w is StoredWorkflow => w !== null),
    );
  }

  /** Every enabled schedule workflow. */
  scheduled(): StoredWorkflow[] {
    return this.db
      .select()
      .from(workflows)
      .where(eq(workflows.enabled, true))
      .all()
      .map(toStored)
      .filter((w): w is StoredWorkflow => w !== null && w.spec.trigger.kind === "schedule");
  }

  create(operationId: string, spec: WorkflowSpec, createdBy: string | null): StoredWorkflow {
    const row = this.db
      .insert(workflows)
      .values({
        operationId,
        name: spec.name,
        enabled: spec.enabled,
        specJson: specJson(spec),
        createdBy,
      })
      .returning()
      .get();
    return toStored(row) as StoredWorkflow;
  }

  update(id: string, spec: WorkflowSpec): StoredWorkflow | null {
    const row = this.db
      .update(workflows)
      .set({ name: spec.name, enabled: spec.enabled, specJson: specJson(spec) })
      .where(eq(workflows.id, id))
      .returning()
      .get();
    return row ? toStored(row) : null;
  }

  markScheduled(id: string, slot: number): void {
    this.db
      .update(workflows)
      .set({ lastScheduledAt: new Date(slot) })
      .where(eq(workflows.id, id))
      .run();
  }

  delete(id: string): boolean {
    const gone = this.db
      .delete(workflows)
      .where(eq(workflows.id, id))
      .returning({ id: workflows.id })
      .all();
    return gone.length > 0;
  }
}
