/**
 * Persistence of the room task queue (SPEC §5 `tasks`; #37): rows, their run
 * order, state changes, and each room's concurrency settings. Everything the
 * scheduler knows lives here, so the queue survives office restarts.
 *
 * `position` is a per-room, ever-growing sort key (unique per operation). Only
 * queued tasks are ever re-ordered: they swap their existing keys, so a
 * reorder never collides with a running or finished task's key.
 */
import {
  DEFAULT_QUEUE_SETTINGS,
  type ProviderId,
  QUEUE_HISTORY_LIMIT,
  type QueueSettings,
  type TaskKind,
  type TaskState,
} from "@regulus/protocol";
import { and, asc, desc, eq, inArray, isNull, lt, max, sql } from "drizzle-orm";
import type { DbOrTx } from "../auth/audit.ts";
import type { Db } from "../db/index.ts";
import { desks, operationQueueSettings, tasks, userProfiles } from "../db/schema/index.ts";

export type TaskRow = typeof tasks.$inferSelect;

export interface NewTask {
  operationId: string;
  repoId: string;
  kind: TaskKind;
  refNumber: number | null;
  title: string;
  prompt: string;
  provider: ProviderId;
  model: string;
  effort: string | null;
  permissionMode: string | null;
  profileId: string | null;
  autoWorktree: boolean;
  createdBy: string;
  /** The linked task this is a part of (#257). */
  linkedTaskId?: string | null;
}

/** Finished tasks older than this are deleted at boot. */
export const TASK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const FINISHED: TaskState[] = ["done", "failed", "cancelled"];

export class TaskStore {
  constructor(
    readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  get(taskId: string): TaskRow | undefined {
    return this.db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  }

  /** Append at the end of the room's queue. */
  insert(task: NewTask): TaskRow {
    return this.insertAll([task])[0] as TaskRow;
  }

  /**
   * Append several tasks, each at the end of its room's queue, in one
   * transaction with whatever `first` writes (a linked task's own row, #257):
   * all of it is there afterwards, or none.
   */
  insertAll(list: readonly NewTask[], first?: (tx: DbOrTx) => void): TaskRow[] {
    return this.db.transaction((tx) => {
      first?.(tx);
      return list.map((task) => {
        const top = tx
          .select({ max: max(tasks.position) })
          .from(tasks)
          .where(eq(tasks.operationId, task.operationId))
          .get();
        return tx
          .insert(tasks)
          .values({ ...task, position: (top?.max ?? -1) + 1, state: "queued" })
          .returning()
          .get();
      });
    });
  }

  /**
   * The owner stopped this part's henchman themselves (a linked task stopped
   * whole): the part is cancelled, also when the henchman's exit had just
   * marked it failed. False when it had finished some other way.
   */
  cancelStopped(taskId: string): boolean {
    const changed = this.db
      .update(tasks)
      .set({ state: "cancelled", reason: "", finishedAt: new Date(this.now()) })
      .where(and(eq(tasks.id, taskId), inArray(tasks.state, ["queued", "running", "failed"])))
      .returning({ id: tasks.id })
      .all();
    return changed.length > 0;
  }

  /** Queued tasks of a room in run order. */
  queued(operationId: string): TaskRow[] {
    return this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.operationId, operationId), eq(tasks.state, "queued")))
      .orderBy(asc(tasks.position))
      .all();
  }

  running(operationId?: string): TaskRow[] {
    const where = operationId
      ? and(eq(tasks.operationId, operationId), eq(tasks.state, "running"))
      : eq(tasks.state, "running");
    return this.db.select().from(tasks).where(where).orderBy(asc(tasks.startedAt)).all();
  }

  /** What the room shows: queued (run order), running, then recent history. */
  visible(operationId: string): TaskRow[] {
    const history = this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.operationId, operationId), inArray(tasks.state, FINISHED)))
      .orderBy(desc(tasks.finishedAt), desc(tasks.position))
      .limit(QUEUE_HISTORY_LIMIT)
      .all();
    return [...this.queued(operationId), ...this.running(operationId), ...history];
  }

  /** Rooms with work waiting. */
  operationsWithQueued(): string[] {
    return this.db
      .selectDistinct({ operationId: tasks.operationId })
      .from(tasks)
      .where(eq(tasks.state, "queued"))
      .all()
      .map((r) => r.operationId);
  }

  /** Rooms with any task or saved settings (published at boot). */
  operationsWithQueue(): string[] {
    const withTasks = this.db.selectDistinct({ operationId: tasks.operationId }).from(tasks).all();
    const withSettings = this.db
      .select({ operationId: operationQueueSettings.operationId })
      .from(operationQueueSettings)
      .all();
    return [...new Set([...withTasks, ...withSettings].map((r) => r.operationId))];
  }

  /** The running task of a henchman, if it runs one. */
  runningFor(agentId: string): TaskRow | undefined {
    return this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.agentId, agentId), eq(tasks.state, "running")))
      .get();
  }

  /** The latest task a henchman ran (running or finished), for PR linking. */
  latestFor(agentId: string): TaskRow | undefined {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.agentId, agentId))
      .orderBy(desc(tasks.position))
      .get();
  }

  /**
   * Move a queued task to `index` among the room's queued tasks. The queued
   * tasks keep their set of keys and take them in the new order.
   */
  reorder(operationId: string, taskId: string, index: number): boolean {
    return this.db.transaction((tx) => {
      const queued = tx
        .select({ id: tasks.id, position: tasks.position })
        .from(tasks)
        .where(and(eq(tasks.operationId, operationId), eq(tasks.state, "queued")))
        .orderBy(asc(tasks.position))
        .all();
      const from = queued.findIndex((t) => t.id === taskId);
      if (from < 0) return false;
      const keys = queued.map((t) => t.position);
      const order = queued.map((t) => t.id);
      order.splice(from, 1);
      order.splice(Math.min(index, order.length), 0, taskId);
      // Park them on negative keys first: the unique (operation, position) index.
      order.forEach((id, i) => {
        tx.update(tasks)
          .set({ position: -1 - i })
          .where(eq(tasks.id, id))
          .run();
      });
      order.forEach((id, i) => {
        tx.update(tasks)
          .set({ position: keys[i] as number })
          .where(eq(tasks.id, id))
          .run();
      });
      return true;
    });
  }

  /** Back to the end of the queue, as new (retry). */
  requeue(taskId: string): void {
    this.db.transaction((tx) => {
      const row = tx.select().from(tasks).where(eq(tasks.id, taskId)).get();
      if (!row) return;
      const top = tx
        .select({ max: max(tasks.position) })
        .from(tasks)
        .where(eq(tasks.operationId, row.operationId))
        .get();
      tx.update(tasks)
        .set({
          state: "queued",
          position: (top?.max ?? -1) + 1,
          agentId: null,
          prNumber: null,
          reason: "",
          startedAt: null,
          finishedAt: null,
        })
        .where(eq(tasks.id, taskId))
        .run();
    });
  }

  markRunning(taskId: string): void {
    this.db
      .update(tasks)
      .set({ state: "running", reason: "", startedAt: new Date(this.now()), finishedAt: null })
      .where(and(eq(tasks.id, taskId), eq(tasks.state, "queued")))
      .run();
  }

  setAgent(taskId: string, agentId: string): void {
    this.db.update(tasks).set({ agentId }).where(eq(tasks.id, taskId)).run();
  }

  /** A start that never got a henchman: waiting again, at the same place. */
  backToQueue(taskId: string, reason: string): void {
    this.db
      .update(tasks)
      .set({ state: "queued", reason, startedAt: null })
      .where(and(eq(tasks.id, taskId), eq(tasks.state, "running"), isNull(tasks.agentId)))
      .run();
  }

  /** Finish a task; false when it had already finished (or never ran). */
  finish(taskId: string, state: "done" | "failed" | "cancelled", reason = ""): boolean {
    const from: TaskState[] = state === "cancelled" ? ["queued", "running"] : ["running"];
    const changed = this.db
      .update(tasks)
      .set({ state, reason: reason.slice(0, 200), finishedAt: new Date(this.now()) })
      .where(and(eq(tasks.id, taskId), inArray(tasks.state, from)))
      .returning({ id: tasks.id })
      .all();
    return changed.length > 0;
  }

  /** Why a queued task is waiting ("" once it is not blocked). */
  setReason(taskId: string, reason: string): boolean {
    const changed = this.db
      .update(tasks)
      .set({ reason: reason.slice(0, 200) })
      .where(and(eq(tasks.id, taskId), sql`${tasks.reason} <> ${reason.slice(0, 200)}`))
      .returning({ id: tasks.id })
      .all();
    return changed.length > 0;
  }

  linkPr(taskId: string, prNumber: number): boolean {
    const changed = this.db
      .update(tasks)
      .set({ prNumber })
      .where(and(eq(tasks.id, taskId), sql`coalesce(${tasks.prNumber}, 0) <> ${prNumber}`))
      .returning({ id: tasks.id })
      .all();
    return changed.length > 0;
  }

  settings(operationId: string): QueueSettings {
    const row = this.db
      .select()
      .from(operationQueueSettings)
      .where(eq(operationQueueSettings.operationId, operationId))
      .get();
    return row
      ? { maxRunning: row.maxRunning, maxPerOwner: row.maxPerOwner }
      : { ...DEFAULT_QUEUE_SETTINGS };
  }

  saveSettings(operationId: string, settings: QueueSettings): void {
    this.db
      .insert(operationQueueSettings)
      .values({ operationId, ...settings })
      .onConflictDoUpdate({ target: operationQueueSettings.operationId, set: { ...settings } })
      .run();
  }

  /** Free desks of a room right now. */
  freeDesks(operationId: string): number {
    const row = this.db
      .select({ n: sql<number>`count(*)` })
      .from(desks)
      .where(and(eq(desks.operationId, operationId), isNull(desks.agentId)))
      .get();
    return Number(row?.n ?? 0);
  }

  ownerNames(userIds: readonly string[]): Map<string, string> {
    if (userIds.length === 0) return new Map();
    const rows = this.db
      .select({ userId: userProfiles.userId, name: userProfiles.displayName })
      .from(userProfiles)
      .where(inArray(userProfiles.userId, [...new Set(userIds)]))
      .all();
    return new Map(rows.map((r) => [r.userId, r.name]));
  }

  /** Drop long-finished tasks (boot). */
  prune(): void {
    const cutoff = new Date(this.now() - TASK_RETENTION_MS);
    this.db
      .delete(tasks)
      .where(and(inArray(tasks.state, FINISHED), lt(tasks.finishedAt, cutoff)))
      .run();
  }
}
