/**
 * Persistence of the room task queue (SPEC §5 `tasks`; #37): rows, their run
 * order, state changes, and each room's concurrency settings. Everything the
 * scheduler knows lives here, so the queue survives office restarts.
 *
 * `position` is a per-room, ever-growing sort key (unique per floor). Only
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
import type { Db } from "../db/index.ts";
import { desks, floorQueueSettings, tasks, userProfiles } from "../db/schema/index.ts";

export type TaskRow = typeof tasks.$inferSelect;

export interface NewTask {
  floorId: string;
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
    return this.db.transaction((tx) => {
      const top = tx
        .select({ max: max(tasks.position) })
        .from(tasks)
        .where(eq(tasks.floorId, task.floorId))
        .get();
      return tx
        .insert(tasks)
        .values({ ...task, position: (top?.max ?? -1) + 1, state: "queued" })
        .returning()
        .get();
    });
  }

  /** Queued tasks of a room in run order. */
  queued(floorId: string): TaskRow[] {
    return this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.floorId, floorId), eq(tasks.state, "queued")))
      .orderBy(asc(tasks.position))
      .all();
  }

  running(floorId?: string): TaskRow[] {
    const where = floorId
      ? and(eq(tasks.floorId, floorId), eq(tasks.state, "running"))
      : eq(tasks.state, "running");
    return this.db.select().from(tasks).where(where).orderBy(asc(tasks.startedAt)).all();
  }

  /** What the room shows: queued (run order), running, then recent history. */
  visible(floorId: string): TaskRow[] {
    const history = this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.floorId, floorId), inArray(tasks.state, FINISHED)))
      .orderBy(desc(tasks.finishedAt), desc(tasks.position))
      .limit(QUEUE_HISTORY_LIMIT)
      .all();
    return [...this.queued(floorId), ...this.running(floorId), ...history];
  }

  /** Rooms with work waiting. */
  floorsWithQueued(): string[] {
    return this.db
      .selectDistinct({ floorId: tasks.floorId })
      .from(tasks)
      .where(eq(tasks.state, "queued"))
      .all()
      .map((r) => r.floorId);
  }

  /** Rooms with any task or saved settings (published at boot). */
  floorsWithQueue(): string[] {
    const withTasks = this.db.selectDistinct({ floorId: tasks.floorId }).from(tasks).all();
    const withSettings = this.db
      .select({ floorId: floorQueueSettings.floorId })
      .from(floorQueueSettings)
      .all();
    return [...new Set([...withTasks, ...withSettings].map((r) => r.floorId))];
  }

  /** The running task of a robot, if it runs one. */
  runningFor(agentId: string): TaskRow | undefined {
    return this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.agentId, agentId), eq(tasks.state, "running")))
      .get();
  }

  /** The latest task a robot ran (running or finished), for PR linking. */
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
  reorder(floorId: string, taskId: string, index: number): boolean {
    return this.db.transaction((tx) => {
      const queued = tx
        .select({ id: tasks.id, position: tasks.position })
        .from(tasks)
        .where(and(eq(tasks.floorId, floorId), eq(tasks.state, "queued")))
        .orderBy(asc(tasks.position))
        .all();
      const from = queued.findIndex((t) => t.id === taskId);
      if (from < 0) return false;
      const keys = queued.map((t) => t.position);
      const order = queued.map((t) => t.id);
      order.splice(from, 1);
      order.splice(Math.min(index, order.length), 0, taskId);
      // Park them on negative keys first: the unique (floor, position) index.
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
        .where(eq(tasks.floorId, row.floorId))
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

  /** A start that never got a robot: waiting again, at the same place. */
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

  settings(floorId: string): QueueSettings {
    const row = this.db
      .select()
      .from(floorQueueSettings)
      .where(eq(floorQueueSettings.floorId, floorId))
      .get();
    return row
      ? { maxRunning: row.maxRunning, maxPerOwner: row.maxPerOwner }
      : { ...DEFAULT_QUEUE_SETTINGS };
  }

  saveSettings(floorId: string, settings: QueueSettings): void {
    this.db
      .insert(floorQueueSettings)
      .values({ floorId, ...settings })
      .onConflictDoUpdate({ target: floorQueueSettings.floorId, set: { ...settings } })
      .run();
  }

  /** Free desks of a room right now. */
  freeDesks(floorId: string): number {
    const row = this.db
      .select({ n: sql<number>`count(*)` })
      .from(desks)
      .where(and(eq(desks.floorId, floorId), isNull(desks.agentId)))
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
