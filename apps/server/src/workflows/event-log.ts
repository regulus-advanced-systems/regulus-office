/**
 * Recent GitHub events of followed repos (#155), kept so a workflow can be
 * dry-run against a real past event. Only the capped workflow context is
 * stored (no raw payload), pruned to {@link KEEP_EVENTS} rows and
 * {@link KEEP_MS} of age.
 */
import type { WorkflowEventView } from "@regulus/protocol";
import { desc, eq, lt, notInArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { workflowEvents } from "../db/schema/index.ts";
import { contextSummary, type WorkflowContext } from "./context.ts";

export const KEEP_EVENTS = 500;
export const KEEP_MS = 14 * 24 * 60 * 60_000;
const PRUNE_EVERY = 50;

type Row = typeof workflowEvents.$inferSelect;

function toView(row: Row): WorkflowEventView {
  let floorIds: string[] = [];
  try {
    floorIds = JSON.parse(row.floorIdsJson) as string[];
  } catch {
    floorIds = [];
  }
  return {
    id: row.id,
    floorIds,
    name: (row.action ? `${row.name}.${row.action}` : row.name).slice(0, 80),
    repo: row.repo,
    summary: row.summary,
    sender: row.sender,
    receivedAt: row.receivedAt.getTime(),
  };
}

export class EventLog {
  #writes = 0;

  constructor(private readonly db: Db) {}

  record(ctx: WorkflowContext): void {
    if (ctx.floorIds.length === 0) return;
    this.db
      .insert(workflowEvents)
      .values({
        deliveryId: ctx.deliveryId.slice(0, 200),
        name: ctx.name,
        action: ctx.action,
        repo: ctx.repo?.fullName ?? null,
        floorIdsJson: JSON.stringify(ctx.floorIds),
        summary: contextSummary(ctx),
        sender: ctx.sender?.login ?? null,
        eventJson: JSON.stringify(ctx),
        receivedAt: new Date(ctx.receivedAt),
      })
      .onConflictDoNothing()
      .run();
    this.#writes += 1;
    if (this.#writes % PRUNE_EVERY === 0) this.prune(ctx.receivedAt);
  }

  /** Newest first, only those that concern `floorId`. */
  listForFloor(floorId: string, limit = 50): WorkflowEventView[] {
    const out: WorkflowEventView[] = [];
    const rows = this.db
      .select()
      .from(workflowEvents)
      .orderBy(desc(workflowEvents.receivedAt))
      .limit(KEEP_EVENTS)
      .all();
    for (const row of rows) {
      const view = toView(row);
      if (view.floorIds.includes(floorId)) out.push(view);
      if (out.length >= limit) break;
    }
    return out;
  }

  get(id: string): { view: WorkflowEventView; context: WorkflowContext } | null {
    const row = this.db.select().from(workflowEvents).where(eq(workflowEvents.id, id)).get();
    if (!row) return null;
    try {
      return { view: toView(row), context: JSON.parse(row.eventJson) as WorkflowContext };
    } catch {
      return null;
    }
  }

  prune(now: number): void {
    this.db
      .delete(workflowEvents)
      .where(lt(workflowEvents.receivedAt, new Date(now - KEEP_MS)))
      .run();
    const keep = this.db
      .select({ id: workflowEvents.id })
      .from(workflowEvents)
      .orderBy(desc(workflowEvents.receivedAt))
      .limit(KEEP_EVENTS)
      .all()
      .map((r) => r.id);
    if (keep.length >= KEEP_EVENTS) {
      this.db.delete(workflowEvents).where(notInArray(workflowEvents.id, keep)).run();
    }
  }
}
