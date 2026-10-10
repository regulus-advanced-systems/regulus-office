/**
 * One task across several repos (#257; D7, D26, D27, D34): creating it,
 * showing it to one viewer, stopping it, its notes, and what happens as its
 * parts run.
 *
 * A linked task is made of ordinary queue tasks, one per room, so each part
 * keeps every rule of the queue (service.ts, scheduler.ts): it starts as its
 * owner, with their credentials, in their runner, while they may still spawn
 * in that room. This module adds only what the parts share.
 *
 * - **Create**: write access (`spawn`/`manage`) to every room named, all on one
 *   level, every part admitted by the queue's own checks, then the task and
 *   all its parts in one transaction. A room the person cannot use, cannot see
 *   or that does not exist gives the same refusal, so the answer tells nothing
 *   about a room.
 * - **See**: views.ts. Nothing about a linked task is in a room's live state:
 *   that state is the same for everyone in the room, and some of them may not
 *   see the other rooms. For the same reason nothing this module writes on a
 *   part's queue row (its reason) says that the part belongs to more.
 * - **Stop**: the task's owner stops every part they still have queued or
 *   running. A running part counts as stopped once its henchman really has
 *   stopped; one that refuses is reported and carries on. Finished parts are
 *   left as they are: their henchmen sit idle with finished work and an open
 *   pull request the owner may still want changed, and stopping them is the
 *   owner's own click on each. Cancelling or failing one part touches only it.
 * - **Notes**: notes.ts. Only the owner reads them and only the owner passes
 *   them on.
 * - **Pull requests**: whenever the henchman of a finished part ends a turn and
 *   the part has no pull request yet, the office opens a draft from its branch
 *   as the owner, as the one-click PR would (same checks, same project
 *   credential). A part that stopped to ask something and has committed
 *   nothing gets none, says why, and is tried again when its henchman next
 *   ends a turn, and at boot. pull-links.ts lets the pull requests name each
 *   other.
 */
import {
  type CreateLinkedTaskRequest,
  LINKED_TASK_PARTS_MAX,
  LINKED_TASK_PARTS_MIN,
  type LinkedTaskCreated,
  type LinkedTaskOk,
  type LinkedTaskStopped,
  type LinkedTaskView,
  mayQueueTask,
} from "@regulus/protocol";
import { desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { AgentManagerError } from "../../agents/manager/errors.ts";
import type { AgentObserver } from "../../agents/manager/runtime.ts";
import { operationRepos, operations } from "../../db/schema/index.ts";
import type { Logger } from "../../logging.ts";
import { accessibleOperations, type OperationActor } from "../../operations/access.ts";
import { QueueError, type QueueHooks, type TaskQueue } from "../service.ts";
import type { NewTask, TaskRow } from "../store.ts";
import type { NotesSync } from "./notes.ts";
import { partPrompt } from "./prompt.ts";
import type { PullLinker } from "./pull-links.ts";
import type { LinkedTaskRow, LinkedTaskStore } from "./store.ts";
import { viewFor } from "./views.ts";

export type CreateInput = z.output<typeof CreateLinkedTaskRequest>;

/** What the linked tasks need from the AgentManager; both act as the henchman's owner. */
export interface LinkedHenchmen {
  openDraftPullRequest(owner: OperationActor, agentId: string): Promise<unknown>;
  /** Resolves once the henchman has stopped; rejects when it may not be or could not be. */
  stop(owner: OperationActor, agentId: string): Promise<void>;
}

export const NO_ROOM = "you may not queue tasks in every one of these rooms";
const NO_PULL = "the pull request could not be opened";
const NO_TASK = "no such task";

export interface LinkedTasksDeps {
  store: LinkedTaskStore;
  queue: TaskQueue;
  henchmen: LinkedHenchmen;
  notes: NotesSync;
  pulls: PullLinker;
  logger: Logger;
}

export class LinkedTasks {
  readonly #deps: LinkedTasksDeps;
  /** Draft pull requests being opened, by henchman. */
  readonly #opening = new Map<string, Promise<void>>();

  constructor(deps: LinkedTasksDeps) {
    this.#deps = deps;
  }

  /** What the queue asks of the linked tasks (`TaskQueue.extend`). */
  readonly hooks: QueueHooks = {
    promptFor: (task) => (task.linkedTaskId ? partPrompt(task.prompt) : undefined),
    taskFinished: (task) => {
      if (task.linkedTaskId) void this.#deps.notes.sync(task.linkedTaskId);
    },
    pullRequestLinked: (task) => {
      if (!task.linkedTaskId) return;
      this.#deps.store.setPrNote(task.id, "");
      void this.#deps.pulls.relink(task.linkedTaskId);
    },
  };

  /**
   * Pass to the AgentManager after the queue's own observer: when a henchman
   * ends a turn, its finished part gets its draft pull request if it has none.
   */
  readonly observer: AgentObserver = {
    statusChanged: (view, previous) => {
      const ended = view.status === "done" || (view.status === "idle" && previous === "working");
      if (!ended) return;
      const part = this.#deps.store.donePartOf(view.agentId);
      if (part) this.#openDraft(part);
    },
    pullRequestOpened: () => {},
  };

  create(actor: OperationActor, input: CreateInput): LinkedTaskCreated {
    const { store, queue } = this.#deps;
    const db = store.db;
    const ids = input.operationIds;
    if (
      new Set(ids).size !== ids.length ||
      ids.length < LINKED_TASK_PARTS_MIN ||
      ids.length > LINKED_TASK_PARTS_MAX
    ) {
      throw new QueueError(
        "bad_request",
        `name ${LINKED_TASK_PARTS_MIN} to ${LINKED_TASK_PARTS_MAX} different rooms`,
      );
    }
    // Access first: nothing below may tell of a room the person cannot work in.
    const access = accessibleOperations(db, actor);
    if (!ids.every((id) => mayQueueTask(access.get(id))))
      throw new QueueError("forbidden", NO_ROOM);
    const rooms = db
      .select({ id: operations.id, levelId: operations.levelId })
      .from(operations)
      .where(inArray(operations.id, ids))
      .all();
    if (new Set(rooms.map((r) => r.levelId)).size !== 1) {
      throw new QueueError("bad_request", "the rooms of one task must be on the same level");
    }
    const linkedTaskId = crypto.randomUUID();
    const prepared: NewTask[] = ids.map((operationId) => {
      const repo = db
        .select({ id: operationRepos.id })
        .from(operationRepos)
        .where(eq(operationRepos.operationId, operationId))
        .orderBy(desc(operationRepos.isPrimary))
        .get();
      if (!repo) throw new QueueError("bad_request", "one of these rooms has no repo");
      return queue.prepareTask(actor, {
        operationId,
        repoId: repo.id,
        kind: "freeform",
        ...(input.title?.trim() ? { title: input.title.trim() } : {}),
        prompt: input.prompt,
        provider: input.provider,
        model: input.model,
        ...(input.effort ? { effort: input.effort } : {}),
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
        ...(input.profileId ? { profileId: input.profileId } : {}),
        // Every part needs its own branch for its pull request.
        autoWorktree: true,
        linkedTaskId,
      });
    });
    // The task and every part, or nothing: a crash cannot leave a one-part task.
    const rows = queue.insertPrepared(prepared, (tx) =>
      store.create(tx, {
        id: linkedTaskId,
        title: prepared[0]?.title ?? "",
        createdBy: actor.id,
        namePrivateRepos: input.namePrivateRepos,
      }),
    );
    this.#deps.logger.info({ linkedTaskId, parts: rows.length }, "linked task queued");
    return { id: linkedTaskId, taskIds: rows.map((r) => r.id) };
  }

  /** Linked tasks with a part in a room, as this viewer may see them (possibly none). */
  list(actor: OperationActor, operationId: string): LinkedTaskView[] {
    const { store, queue } = this.#deps;
    const access = accessibleOperations(store.db, actor);
    if (!access.has(operationId)) return [];
    const out: LinkedTaskView[] = [];
    for (const id of store.idsInOperation(operationId)) {
      const linked = store.get(id);
      if (!linked) continue;
      const ownerName = queue.store.ownerNames([linked.createdBy]).get(linked.createdBy) ?? "";
      const view = viewFor({
        linked,
        parts: store.parts(id),
        viewerId: actor.id,
        ownerName,
        access,
        notes: linked.createdBy === actor.id ? store.notesOf(id) : [],
      });
      if (view) out.push(view);
    }
    return out;
  }

  /** The task, for its owner; somebody else's task and no task at all look the same. */
  #owned(actor: OperationActor, linkedTaskId: string): LinkedTaskRow {
    const linked = this.#deps.store.get(linkedTaskId);
    if (!linked || linked.createdBy !== actor.id) throw new QueueError("not_found", NO_TASK);
    return linked;
  }

  /** Stop every part the owner still has queued or running. */
  async stop(actor: OperationActor, linkedTaskId: string): Promise<LinkedTaskStopped> {
    const { store, queue, henchmen } = this.#deps;
    this.#owned(actor, linkedTaskId);
    let stopped = 0;
    let refused = 0;
    for (const task of store.tasksOf(linkedTaskId)) {
      if (task.state !== "queued" && task.state !== "running") continue;
      if (task.state === "running" && task.agentId) {
        try {
          await henchmen.stop(actor, task.agentId);
        } catch (err) {
          const reason = err instanceof AgentManagerError ? err.message : "unexpected error";
          this.#deps.logger.info({ taskId: task.id, reason }, "a part's henchman was not stopped");
          refused += 1;
          continue;
        }
      }
      // Cancelled, also when the henchman's own exit had just marked it failed.
      if (queue.store.cancelStopped(task.id)) stopped += 1;
      queue.publish(task.operationId);
      void queue.scheduler.kick(task.operationId);
    }
    return { id: linkedTaskId, stopped, refused };
  }

  /** Pass one note on to the other parts (the owner). */
  releaseNote(actor: OperationActor, linkedTaskId: string, noteId: string): LinkedTaskOk {
    this.#owned(actor, linkedTaskId);
    if (!this.#deps.store.releaseNote(linkedTaskId, noteId)) {
      throw new QueueError("not_found", "no such note to pass on");
    }
    void this.#deps.notes.sync(linkedTaskId);
    return { id: linkedTaskId };
  }

  /** Pass notes on without asking, from now on (the owner); off by default. */
  setAutoNotes(actor: OperationActor, linkedTaskId: string, on: boolean): LinkedTaskOk {
    this.#owned(actor, linkedTaskId);
    this.#deps.store.setReleaseNotes(linkedTaskId, on);
    return { id: linkedTaskId };
  }

  /** After the queue's own boot: what went stale while the office was down. */
  recover(): void {
    const { store, pulls } = this.#deps;
    store.pruneEmpty();
    for (const task of store.doneWithoutPull()) this.#openDraft(task);
    for (const linked of store.all()) void pulls.relink(linked.id);
  }

  #openDraft(task: TaskRow): void {
    const agentId = task.agentId;
    if (!agentId || task.prNumber || this.#opening.has(agentId)) return;
    const { store, queue, henchmen } = this.#deps;
    const owner = queue.scheduler.ownerActor(task.createdBy);
    if (!owner) return;
    const run = henchmen
      .openDraftPullRequest(owner, agentId)
      .then(
        () => undefined,
        (err: unknown) => {
          // Manager errors are safe to show (no commits, uncommitted files, lost access).
          const note = err instanceof AgentManagerError ? err.message : NO_PULL;
          store.setPrNote(task.id, note);
          this.#deps.logger.info({ taskId: task.id, note }, "no draft pull request for a part");
        },
      )
      .finally(() => this.#opening.delete(agentId));
    this.#opening.set(agentId, run);
  }

  /** Wait for work in flight (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.#opening.size > 0) await Promise.all(this.#opening.values());
    await this.#deps.pulls.idle();
    await this.#deps.notes.idle();
  }
}
