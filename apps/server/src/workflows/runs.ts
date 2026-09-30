/**
 * Workflow runs (#155): the run history and the queue in one table. A run is
 * unique per (workflow, delivery id), which is the dedupe of repeated
 * deliveries and of the webhook + poll pair for one change.
 */
import {
  type WorkflowProvider,
  type WorkflowRunDetail,
  type WorkflowRunLink,
  type WorkflowRunStatus,
  type WorkflowRunView,
  type WorkflowTarget,
  type WorkflowUsageToday,
} from "@regulus/protocol";
import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { workflowRuns, workflows } from "../db/schema/index.ts";
import type { WorkflowContext } from "./context.ts";

export type RunRow = typeof workflowRuns.$inferSelect;

/** UTC day of a timestamp, `YYYY-MM-DD`. */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export interface NewRun {
  workflowId: string;
  floorId: string;
  deliveryId: string;
  trigger: string;
  target: WorkflowTarget | null;
  targetKey: string | null;
  context: WorkflowContext;
  provider: WorkflowProvider;
  model: string | null;
  status: WorkflowRunStatus;
  reason?: string | null;
  now: number;
}

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

const FINISHED: WorkflowRunStatus[] = ["succeeded", "failed", "refused", "skipped", "cancelled"];
/** Runs that count toward the daily run limit: everything that got (or will get) a robot. */
const COUNTED: WorkflowRunStatus[] = ["queued", "running", "succeeded", "failed", "cancelled"];

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export const robotName = (runId: string): string => `Reviewer ${runId.slice(0, 4).toUpperCase()}`;

export function toRunView(row: RunRow, workflowName: string): WorkflowRunView {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowName: workflowName.slice(0, 80) || "workflow",
    floorId: row.floorId,
    trigger: row.trigger.slice(0, 80),
    deliveryId: row.deliveryId.slice(0, 200),
    target: parseJson<WorkflowTarget | null>(row.targetJson, null),
    status: row.status,
    reason: row.reason,
    provider: row.provider,
    model: row.model,
    robot: robotName(row.id),
    queuedAt: row.queuedAt.getTime(),
    startedAt: row.startedAt?.getTime() ?? null,
    finishedAt: row.finishedAt?.getTime() ?? null,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd,
    links: parseJson<WorkflowRunLink[]>(row.linksJson, []),
  };
}

export class RunStore {
  constructor(private readonly db: Db) {}

  /** Insert a run; null when this workflow already has one for the delivery (dedupe). */
  insert(run: NewRun): RunRow | null {
    const finished = FINISHED.includes(run.status);
    const rows = this.db
      .insert(workflowRuns)
      .values({
        workflowId: run.workflowId,
        floorId: run.floorId,
        deliveryId: run.deliveryId.slice(0, 200),
        trigger: run.trigger.slice(0, 80),
        targetKey: run.targetKey,
        targetJson: run.target ? JSON.stringify(run.target) : null,
        contextJson: JSON.stringify(run.context),
        status: run.status,
        reason: run.reason ?? null,
        provider: run.provider,
        model: run.model,
        day: utcDay(run.now),
        queuedAt: new Date(run.now),
        finishedAt: finished ? new Date(run.now) : null,
      })
      .onConflictDoNothing()
      .returning()
      .all();
    return rows[0] ?? null;
  }

  get(id: string): RunRow | null {
    return this.db.select().from(workflowRuns).where(eq(workflowRuns.id, id)).get() ?? null;
  }

  context(row: RunRow): WorkflowContext {
    return parseJson<WorkflowContext>(row.contextJson, {} as WorkflowContext);
  }

  detail(id: string): WorkflowRunDetail | null {
    const row = this.db
      .select({ run: workflowRuns, name: workflows.name })
      .from(workflowRuns)
      .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
      .where(eq(workflowRuns.id, id))
      .get();
    if (!row) return null;
    return {
      ...toRunView(row.run, row.name),
      log: parseJson<string[]>(row.run.logJson, []).slice(-500),
      summary: row.run.summary,
    };
  }

  list(opts: { floorId: string; workflowId?: string; limit?: number }): WorkflowRunView[] {
    const where = opts.workflowId
      ? and(eq(workflowRuns.floorId, opts.floorId), eq(workflowRuns.workflowId, opts.workflowId))
      : eq(workflowRuns.floorId, opts.floorId);
    return this.db
      .select({ run: workflowRuns, name: workflows.name })
      .from(workflowRuns)
      .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
      .where(where)
      .orderBy(desc(workflowRuns.queuedAt))
      .limit(Math.min(opts.limit ?? 50, 200))
      .all()
      .map((r) => toRunView(r.run, r.name));
  }

  /** Queued runs, oldest first. */
  queued(): RunRow[] {
    return this.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.status, "queued"))
      .orderBy(workflowRuns.queuedAt)
      .all();
  }

  running(): RunRow[] {
    return this.db.select().from(workflowRuns).where(eq(workflowRuns.status, "running")).all();
  }

  today(workflowId: string, now: number): WorkflowUsageToday {
    const row = this.db
      .select({
        runs: sql<number>`count(*)`,
        tokens: sql<number>`coalesce(sum(${workflowRuns.inputTokens} + ${workflowRuns.outputTokens}), 0)`,
        cost: sql<number>`coalesce(sum(${workflowRuns.costUsd}), 0)`,
      })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.workflowId, workflowId),
          eq(workflowRuns.day, utcDay(now)),
          inArray(workflowRuns.status, COUNTED),
        ),
      )
      .get();
    return { runs: row?.runs ?? 0, tokens: row?.tokens ?? 0, costUsd: row?.cost ?? 0 };
  }

  /** When this workflow last queued a run for the target (cooldown). */
  lastForTarget(workflowId: string, targetKey: string): number | null {
    const row = this.db
      .select({ at: max(workflowRuns.queuedAt) })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.workflowId, workflowId),
          eq(workflowRuns.targetKey, targetKey),
          inArray(workflowRuns.status, COUNTED),
        ),
      )
      .get();
    return row?.at ? row.at.getTime() : null;
  }

  /** queued → running; false when someone else took or cancelled it. */
  start(id: string, now: number): boolean {
    const rows = this.db
      .update(workflowRuns)
      .set({ status: "running", startedAt: new Date(now) })
      .where(and(eq(workflowRuns.id, id), eq(workflowRuns.status, "queued")))
      .returning({ id: workflowRuns.id })
      .all();
    return rows.length > 0;
  }

  progress(
    id: string,
    patch: { log?: string[]; target?: WorkflowTarget; links?: WorkflowRunLink[] },
  ): void {
    this.db
      .update(workflowRuns)
      .set({
        ...(patch.log ? { logJson: JSON.stringify(patch.log.slice(-500)) } : {}),
        ...(patch.target ? { targetJson: JSON.stringify(patch.target) } : {}),
        ...(patch.links ? { linksJson: JSON.stringify(patch.links) } : {}),
      })
      .where(eq(workflowRuns.id, id))
      .run();
  }

  finish(
    id: string,
    result: {
      status: WorkflowRunStatus;
      reason: string | null;
      now: number;
      log: string[];
      summary?: string | null;
      links?: WorkflowRunLink[];
      usage?: RunUsage;
    },
  ): void {
    this.db
      .update(workflowRuns)
      .set({
        status: result.status,
        reason: result.reason?.slice(0, 300) ?? null,
        finishedAt: new Date(result.now),
        logJson: JSON.stringify(result.log.slice(-500)),
        ...(result.summary !== undefined ? { summary: result.summary } : {}),
        ...(result.links ? { linksJson: JSON.stringify(result.links) } : {}),
        ...(result.usage ? result.usage : {}),
      })
      .where(and(eq(workflowRuns.id, id), inArray(workflowRuns.status, ["queued", "running"])))
      .run();
  }
}
