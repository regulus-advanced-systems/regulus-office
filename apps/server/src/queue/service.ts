/**
 * The room task queue (SPEC §5 `tasks`, §9.4 clipboard; issue #37).
 *
 * `enqueueTask` is the server API: the FloorRoom's `queue.add` calls it, and
 * so can the workflows follow-up (#155). Reorder, cancel, retry and the
 * concurrency settings follow the protocol ACL (queue-api.ts): reorder and
 * cancel by the task's owner or a room manager, retry by the owner only
 * (it spends their credentials again), settings by room managers.
 *
 * The human who queues a task owns the robot it spawns (SPEC §8): the task
 * stores their id and credential profile reference, and the scheduler
 * starts it as them, only while they may still spawn in the room.
 * Cancelling a running task lets go of it (its slot frees); its robot keeps
 * running, because only its owner may stop it (D12).
 */
import {
  isPermissionModeFor,
  mayConfigureQueue,
  mayManageQueuedTask,
  mayQueueTask,
  mayRetryTask,
  type PermissionMode,
  type ProviderId,
  type QueueSettings,
  type QueueTask,
  type TaskKind,
} from "@regulus/protocol";
import { and, eq } from "drizzle-orm";
import { AgentManagerError } from "../agents/manager/errors.ts";
import type { AgentObserver } from "../agents/manager/runtime.ts";
import type { Db } from "../db/index.ts";
import { floorRepos } from "../db/schema/index.ts";
import { type FloorActor, floorAccessFor } from "../floors/access.ts";
import type { GitHubEventBus } from "../github/events.ts";
import type { Logger } from "../logging.ts";
import { taskContent } from "./content.ts";
import { agentsOnBranch, cachedPrFor, pullFromEvent } from "./pr-link.ts";
import { toQueueTask } from "./publish.ts";
import { QueueScheduler, type QueueSpawner } from "./scheduler.ts";
import { type TaskRow, TaskStore } from "./store.ts";

/** Queued (not yet started) tasks a room holds at most. */
export const MAX_QUEUED_PER_ROOM = 100;
/** How often every room with queued work is re-checked (desks freed, access changed). */
export const QUEUE_TICK_MS = 5_000;

export type QueueErrorCode = "bad_request" | "forbidden" | "not_found" | "conflict";

/** Refusals with messages safe to show the human. */
export class QueueError extends Error {
  override name = "QueueError";
  constructor(
    readonly code: QueueErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface EnqueueInput {
  floorId: string;
  repoId: string;
  kind: TaskKind;
  refNumber?: number;
  title?: string;
  /** Freeform tasks need one; issue / PR tasks get one from the card. */
  prompt?: string;
  provider: ProviderId;
  model: string;
  effort?: string;
  permissionMode?: PermissionMode;
  /** The queuer's own profile id or `office:<provider>`; omitted = their CLI login. */
  profileId?: string;
  autoWorktree?: boolean;
}

/** Where the queue is shown (FloorRooms). */
export interface QueuePublisher {
  publishQueue(floorId: string, tasks: readonly QueueTask[], settings: QueueSettings): void;
}

export interface TaskQueueOptions {
  db: Db;
  spawner: QueueSpawner;
  publisher: QueuePublisher;
  logger: Logger;
  now?: () => number;
  tickIntervalMs?: number;
}

export class TaskQueue {
  readonly store: TaskStore;
  readonly scheduler: QueueScheduler;
  readonly #opts: TaskQueueOptions;
  readonly #logger: Logger;
  #timer: ReturnType<typeof setInterval> | undefined;
  #offGitHub: (() => void) | undefined;

  constructor(opts: TaskQueueOptions) {
    this.#opts = opts;
    this.#logger = opts.logger.child({ component: "queue" });
    this.store = new TaskStore(opts.db, opts.now);
    this.scheduler = new QueueScheduler({
      store: this.store,
      spawner: opts.spawner,
      logger: this.#logger,
      changed: (floorId) => this.publish(floorId),
    });
  }

  // ---- Server API ------------------------------------------------------------

  /** Queue a task owned by `actor` (their credentials, their runner). */
  enqueueTask(actor: FloorActor, input: EnqueueInput): TaskRow {
    const access = floorAccessFor(this.#opts.db, actor, input.floorId);
    if (!mayQueueTask(access)) {
      throw new QueueError("forbidden", "you may not queue tasks in this room");
    }
    const repo = this.#opts.db
      .select({ id: floorRepos.id })
      .from(floorRepos)
      .where(and(eq(floorRepos.id, input.repoId), eq(floorRepos.floorId, input.floorId)))
      .get();
    if (!repo) throw new QueueError("bad_request", "no such repo in this room");
    if ((input.kind === "freeform") === (input.refNumber !== undefined)) {
      throw new QueueError("bad_request", "issue and PR tasks need a number, freeform ones none");
    }
    const prompt = input.prompt?.trim() ?? "";
    if (input.kind === "freeform" && !prompt) {
      throw new QueueError("bad_request", "a freeform task needs a prompt");
    }
    if (input.permissionMode && !isPermissionModeFor(input.provider, input.permissionMode)) {
      throw new QueueError(
        "bad_request",
        `${input.provider} has no permission mode ${input.permissionMode}`,
      );
    }
    if (this.store.queued(input.floorId).length >= MAX_QUEUED_PER_ROOM) {
      throw new QueueError("conflict", "this room's queue is full");
    }
    const content = taskContent(this.#opts.db, { ...input, prompt });
    const autoWorktree = input.autoWorktree ?? true;
    // What could never start is refused now, not when its turn comes.
    try {
      this.#opts.spawner.check(actor, {
        floorId: input.floorId,
        repoId: input.repoId,
        provider: input.provider,
        model: input.model,
        permissionMode: input.permissionMode,
        profileId: input.profileId,
        prompt: content.prompt,
        autoWorktree,
      });
    } catch (err) {
      if (err instanceof AgentManagerError) throw new QueueError("bad_request", err.message);
      throw err;
    }
    const row = this.store.insert({
      floorId: input.floorId,
      repoId: input.repoId,
      kind: input.kind,
      refNumber: input.refNumber ?? null,
      title: content.title,
      prompt: content.prompt,
      provider: input.provider,
      model: input.model,
      effort: input.effort ?? null,
      permissionMode: input.permissionMode ?? null,
      profileId: input.profileId ?? null,
      autoWorktree,
      createdBy: actor.id,
    });
    this.#logger.info({ taskId: row.id, floorId: row.floorId, kind: row.kind }, "task queued");
    this.publish(row.floorId);
    void this.scheduler.kick(row.floorId);
    return row;
  }

  reorder(actor: FloorActor, floorId: string, taskId: string, position: number): void {
    const task = this.#authorized(actor, floorId, taskId, mayManageQueuedTask);
    if (task.state !== "queued") throw new QueueError("conflict", "only queued tasks move");
    this.store.reorder(floorId, taskId, position);
    this.publish(floorId);
    void this.scheduler.kick(floorId);
  }

  cancel(actor: FloorActor, floorId: string, taskId: string): void {
    const task = this.#authorized(actor, floorId, taskId, mayManageQueuedTask);
    if (!this.store.finish(task.id, "cancelled", cancelledBy(actor, task))) {
      throw new QueueError("conflict", "that task has already finished");
    }
    this.publish(floorId);
    void this.scheduler.kick(floorId);
  }

  retry(actor: FloorActor, floorId: string, taskId: string): void {
    const task = this.#authorized(actor, floorId, taskId, mayRetryTask);
    if (task.state !== "failed" && task.state !== "cancelled") {
      throw new QueueError("conflict", "only failed or cancelled tasks can be retried");
    }
    this.store.requeue(task.id);
    this.publish(floorId);
    void this.scheduler.kick(floorId);
  }

  configure(actor: FloorActor, floorId: string, settings: QueueSettings): void {
    if (!mayConfigureQueue(floorAccessFor(this.#opts.db, actor, floorId))) {
      throw new QueueError("forbidden", "only room managers change the queue settings");
    }
    this.store.saveSettings(floorId, settings);
    this.publish(floorId);
    void this.scheduler.kick(floorId);
  }

  #authorized(
    actor: FloorActor,
    floorId: string,
    taskId: string,
    allowed: (a: FloorActor, access: ReturnType<typeof floorAccessFor>, t: TaskRow) => boolean,
  ): TaskRow {
    const task = this.store.get(taskId);
    if (!task || task.floorId !== floorId) throw new QueueError("not_found", "no such task here");
    if (!allowed(actor, floorAccessFor(this.#opts.db, actor, floorId), task)) {
      throw new QueueError("forbidden", "only the task's owner or a room manager may do that");
    }
    return task;
  }

  // ---- Robots and pull requests ------------------------------------------------

  /** Pass to the AgentManager (with the other observers): robot status and office PRs. */
  readonly observer: AgentObserver = {
    statusChanged: (view, previous) => {
      this.scheduler.agentStatus(view.agentId, view.status, previous, view.statusReason);
      if (view.status === "done") this.#linkFromCache(view.agentId);
    },
    pullRequestOpened: (view, pr) => this.linkPullRequest(view.agentId, pr.number),
  };

  /** The PR a robot opened: shown on its (latest) task. */
  linkPullRequest(agentId: string, prNumber: number): void {
    const task = this.store.latestFor(agentId);
    if (!task || (task.state !== "running" && task.state !== "done")) return;
    if (this.store.linkPr(task.id, prNumber)) this.publish(task.floorId);
  }

  /** Link PRs as they appear on the GitHub event bus (#35). */
  followGitHub(bus: GitHubEventBus): void {
    this.#offGitHub?.();
    this.#offGitHub = bus.on("pull_request", (event) => {
      if (event.stale) return;
      const pr = pullFromEvent(event);
      if (!pr) return;
      for (const agentId of agentsOnBranch(this.#opts.db, event.repoIds, pr.headRef)) {
        this.linkPullRequest(agentId, pr.number);
      }
    });
  }

  #linkFromCache(agentId: string): void {
    const number = cachedPrFor(this.#opts.db, agentId);
    if (number) this.linkPullRequest(agentId, number);
  }

  // ---- Lifecycle -------------------------------------------------------------

  /**
   * After the AgentManager re-adopted its robots: settle what happened while
   * the office was down, publish every room with tasks, and start ticking.
   */
  async boot(): Promise<void> {
    this.scheduler.recover();
    for (const task of this.store.running()) {
      if (task.agentId && !task.prNumber) this.#linkFromCache(task.agentId);
    }
    for (const floorId of this.store.floorsWithQueue()) this.publish(floorId);
    await this.scheduler.kickAll();
    const every = this.#opts.tickIntervalMs ?? QUEUE_TICK_MS;
    this.#timer ??= setInterval(() => void this.scheduler.kickAll(), every);
    this.#timer.unref?.();
  }

  /** What a room shows. */
  snapshot(floorId: string): { tasks: QueueTask[]; settings: QueueSettings } {
    const rows = this.store.visible(floorId);
    const names = this.store.ownerNames(rows.map((r) => r.createdBy));
    return {
      tasks: rows.map((row, i) => toQueueTask(row, i, names.get(row.createdBy) ?? "")),
      settings: this.store.settings(floorId),
    };
  }

  publish(floorId: string): void {
    try {
      const { tasks, settings } = this.snapshot(floorId);
      this.#opts.publisher.publishQueue(floorId, tasks, settings);
    } catch (err) {
      this.#logger.error({ floorId, err: String(err) }, "publishing the queue failed");
    }
  }

  async close(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#offGitHub?.();
    await this.scheduler.idle();
  }
}

function cancelledBy(actor: FloorActor, task: TaskRow): string {
  return actor.id === task.createdBy ? "" : "cancelled by a room manager";
}
