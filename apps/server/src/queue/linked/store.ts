/**
 * Persistence of linked tasks (#257): the `linked_tasks` row, its parts, which
 * are ordinary `tasks` rows carrying its id, and the notes their henchmen left
 * for the owner. Everything a view needs about a part (room, repo, henchman,
 * cached pull request) is read here.
 */
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "../../auth/audit.ts";
import type { Db } from "../../db/index.ts";
import {
  agents,
  githubPulls,
  linkedTaskNotes,
  linkedTasks,
  operationRepos,
  operations,
  tasks,
} from "../../db/schema/index.ts";
import type { TaskRow } from "../store.ts";

export type LinkedTaskRow = typeof linkedTasks.$inferSelect;
export type LinkedNoteRow = typeof linkedTaskNotes.$inferSelect;

/** A part with what the office knows around it. */
export interface PartRow {
  task: TaskRow;
  roomName: string;
  levelId: string;
  repo: { owner: string; name: string; url: string } | null;
  agent: { name: string; ownerUserId: string; workdir: string; repoId: string } | null;
  pull: { state: string; isDraft: boolean; raw: string } | null;
}

export class LinkedTaskStore {
  constructor(
    readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  /** Inside the transaction that queues the parts. */
  create(
    tx: DbOrTx,
    input: { id: string; title: string; createdBy: string; namePrivateRepos: boolean },
  ): void {
    tx.insert(linkedTasks).values(input).run();
  }

  /** Drop linked tasks whose parts are all gone (pruned history, deleted rooms); boot. */
  pruneEmpty(): void {
    this.db
      .delete(linkedTasks)
      .where(
        sql`not exists (select 1 from ${tasks} where ${tasks.linkedTaskId} = ${linkedTasks.id})`,
      )
      .run();
  }

  get(id: string): LinkedTaskRow | undefined {
    return this.db.select().from(linkedTasks).where(eq(linkedTasks.id, id)).get();
  }

  all(): LinkedTaskRow[] {
    return this.db.select().from(linkedTasks).all();
  }

  setReleaseNotes(id: string, releaseNotes: boolean): void {
    this.db.update(linkedTasks).set({ releaseNotes }).where(eq(linkedTasks.id, id)).run();
  }

  setPrNote(taskId: string, prNote: string): void {
    this.db
      .update(tasks)
      .set({ prNote: prNote.slice(0, 200) })
      .where(eq(tasks.id, taskId))
      .run();
  }

  // ---- Notes ------------------------------------------------------------------

  /** A part's new note, and what the office has now seen of its file; one write. */
  addNote(task: TaskRow, body: string, seen: string, released: boolean): void {
    if (!task.linkedTaskId) return;
    const linkedTaskId = task.linkedTaskId;
    this.db.transaction((tx) => {
      tx.insert(linkedTaskNotes)
        .values({
          linkedTaskId,
          taskId: task.id,
          body,
          releasedAt: released ? new Date(this.now()) : null,
        })
        .run();
      tx.update(tasks).set({ notesSeen: seen }).where(eq(tasks.id, task.id)).run();
    });
  }

  /** A task's notes, oldest first. */
  notesOf(linkedTaskId: string): LinkedNoteRow[] {
    return this.db
      .select()
      .from(linkedTaskNotes)
      .where(eq(linkedTaskNotes.linkedTaskId, linkedTaskId))
      .orderBy(asc(linkedTaskNotes.createdAt), sql`${linkedTaskNotes}.rowid`)
      .all();
  }

  /** How much the office keeps of one part's notes. */
  notesSize(taskId: string): number {
    const row = this.db
      .select({ n: sql<number>`coalesce(sum(length(${linkedTaskNotes.body})), 0)` })
      .from(linkedTaskNotes)
      .where(eq(linkedTaskNotes.taskId, taskId))
      .get();
    return Number(row?.n ?? 0);
  }

  /** Release one note of this task; false when there is no such unreleased note. */
  releaseNote(linkedTaskId: string, noteId: string): boolean {
    const changed = this.db
      .update(linkedTaskNotes)
      .set({ releasedAt: new Date(this.now()) })
      .where(
        and(
          eq(linkedTaskNotes.id, noteId),
          eq(linkedTaskNotes.linkedTaskId, linkedTaskId),
          isNull(linkedTaskNotes.releasedAt),
        ),
      )
      .returning({ id: linkedTaskNotes.id })
      .all();
    return changed.length > 0;
  }

  // ---- Parts ------------------------------------------------------------------

  /** The task rows of a linked task, in the order they were named. */
  tasksOf(id: string): TaskRow[] {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.linkedTaskId, id))
      .orderBy(sql`${tasks}.rowid`)
      .all();
  }

  /** Linked tasks with a part in this room. */
  idsInOperation(operationId: string): string[] {
    return this.db
      .selectDistinct({ id: tasks.linkedTaskId })
      .from(tasks)
      .where(and(eq(tasks.operationId, operationId), isNotNull(tasks.linkedTaskId)))
      .all()
      .flatMap((r) => (r.id ? [r.id] : []));
  }

  /** Linked tasks with a part in one of these states. */
  idsWithPartIn(states: readonly TaskRow["state"][]): string[] {
    return this.db
      .selectDistinct({ id: tasks.linkedTaskId })
      .from(tasks)
      .where(and(isNotNull(tasks.linkedTaskId), inArray(tasks.state, [...states])))
      .all()
      .flatMap((r) => (r.id ? [r.id] : []));
  }

  /** The finished part this henchman worked on, if it is one of a linked task. */
  donePartOf(agentId: string): TaskRow | undefined {
    return this.db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.agentId, agentId), isNotNull(tasks.linkedTaskId), eq(tasks.state, "done")),
      )
      .get();
  }

  /** Finished parts without a pull request yet. */
  doneWithoutPull(): TaskRow[] {
    return this.db
      .select()
      .from(tasks)
      .where(
        and(
          isNotNull(tasks.linkedTaskId),
          isNotNull(tasks.agentId),
          eq(tasks.state, "done"),
          sql`coalesce(${tasks.prNumber}, 0) = 0`,
        ),
      )
      .all();
  }

  parts(id: string): PartRow[] {
    return this.tasksOf(id).map((task) => this.#part(task));
  }

  #part(task: TaskRow): PartRow {
    const db = this.db;
    const room = db
      .select({ name: operations.name, levelId: operations.levelId })
      .from(operations)
      .where(eq(operations.id, task.operationId))
      .get();
    const repo = task.repoId
      ? db
          .select({
            owner: operationRepos.owner,
            name: operationRepos.name,
            url: operationRepos.url,
          })
          .from(operationRepos)
          .where(eq(operationRepos.id, task.repoId))
          .get()
      : undefined;
    const agent = task.agentId
      ? db
          .select({
            name: agents.name,
            ownerUserId: agents.ownerUserId,
            workdir: agents.workdir,
            repoId: agents.repoId,
          })
          .from(agents)
          .where(eq(agents.id, task.agentId))
          .get()
      : undefined;
    const pull =
      task.repoId && task.prNumber
        ? db
            .select({
              state: githubPulls.state,
              isDraft: githubPulls.isDraft,
              raw: githubPulls.raw,
            })
            .from(githubPulls)
            .where(and(eq(githubPulls.repoId, task.repoId), eq(githubPulls.number, task.prNumber)))
            .get()
        : undefined;
    return {
      task,
      roomName: room?.name ?? "",
      levelId: room?.levelId ?? "",
      repo: repo ?? null,
      agent: agent ?? null,
      pull: pull ?? null,
    };
  }
}
