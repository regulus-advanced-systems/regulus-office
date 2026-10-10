/**
 * The queue's runner side (#37): starts queued tasks when a room has a free
 * slot and desk (plan.ts), follows their henchmen to done / failed, and puts
 * the queue back together after an office restart.
 *
 * Ownership (SPEC §8): a task is always started as the human who queued it,
 * with their credential profile, in their runner, and only while they may
 * still spawn in the room. The spawn goes through the AgentManager's normal
 * admission (access, repo, provider, profile, desk), so the queue can never
 * start a henchman its owner could not start by hand.
 *
 * A tick is synchronous (the manager admits a henchman synchronously inside
 * `spawn`), so ticks never interleave. A task is marked running before its spawn
 * and gets its henchman id the moment the henchman is admitted, so a restart
 * finds it either with a henchman (followed from then on) or without one
 * (queued again).
 */
import type { AgentStatus, OperationAccess, PermissionMode, UserRole } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { AgentManagerError } from "../agents/manager/errors.ts";
import type { SpawnInput } from "../agents/manager/spawn.ts";
import { agents, userProfiles } from "../db/schema/index.ts";
import type { Logger } from "../logging.ts";
import { type OperationActor, operationAccessFor } from "../operations/access.ts";
import { planQueue, WAIT_REASONS } from "./plan.ts";
import type { TaskRow, TaskStore } from "./store.ts";

/** What the queue needs from the AgentManager. */
export interface QueueSpawner {
  /** Refuse now what could never start (provider, permission mode, profile); throws. */
  check(owner: OperationActor, input: SpawnInput): void;
  spawn(
    owner: OperationActor,
    input: SpawnInput,
    hooks: { onAdmitted(agentId: string): void },
  ): Promise<unknown>;
}

export const FAIL_REASONS = {
  error: "the henchman hit an error",
  exited: "the henchman stopped before it finished",
  offline: "the henchman went offline",
  gone: "the henchman is gone",
  start: "the henchman could not be started",
} as const;

export interface SchedulerDeps {
  store: TaskStore;
  spawner: QueueSpawner;
  logger: Logger;
  /** A room's queue changed: publish it. */
  changed(operationId: string): void;
  /** The prompt a task's henchman starts with, when it is not the stored one (#257). */
  promptFor?(task: TaskRow): string | undefined;
  /** A running task just became done or failed. */
  finished?(task: TaskRow): void;
}

export class QueueScheduler {
  readonly #deps: SchedulerDeps;
  readonly #ticks = new Map<string, Promise<void>>();

  constructor(deps: SchedulerDeps) {
    this.#deps = deps;
  }

  get #store() {
    return this.#deps.store;
  }

  /**
   * Start what can start in a room. Deferred to a microtask, so a burst of
   * changes makes one tick; a kick while one is pending joins it.
   */
  kick(operationId: string): Promise<void> {
    const pending = this.#ticks.get(operationId);
    if (pending) return pending;
    const run = Promise.resolve()
      .then(() => {
        this.#ticks.delete(operationId);
        this.#tick(operationId);
      })
      .catch((err) => {
        this.#ticks.delete(operationId);
        this.#deps.logger.error({ operationId, err: String(err) }, "queue tick failed");
      });
    this.#ticks.set(operationId, run);
    return run;
  }

  /** Every room with queued work (the periodic tick: desks freed, access changed). */
  async kickAll(): Promise<void> {
    await Promise.all(this.#store.operationsWithQueued().map((id) => this.kick(id)));
  }

  /** The human as an actor (id + office role), or null when they are gone. */
  ownerActor(userId: string): OperationActor | null {
    const row = this.#store.db
      .select({ role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .get();
    return row ? { id: userId, role: row.role as UserRole } : null;
  }

  ownerAccess(userId: string, operationId: string): OperationAccess | null {
    const actor = this.ownerActor(userId);
    return actor ? operationAccessFor(this.#store.db, actor, operationId) : null;
  }

  #tick(operationId: string): void {
    const store = this.#store;
    const queued = store.queued(operationId);
    if (queued.length === 0) return;
    const plan = planQueue({
      queued,
      running: store.running(operationId),
      settings: store.settings(operationId),
      freeDesks: store.freeDesks(operationId),
      ownerMaySpawn: (userId) => {
        const access = this.ownerAccess(userId, operationId);
        return access === "spawn" || access === "manage";
      },
    });
    let changed = false;
    for (const task of queued) {
      const reason = plan.waiting.get(task.id);
      if (reason !== undefined && store.setReason(task.id, reason)) changed = true;
    }
    for (const id of plan.start) {
      const task = store.get(id);
      if (task?.state === "queued") {
        this.#start(task);
        changed = true;
      }
    }
    if (changed) this.#deps.changed(operationId);
  }

  /**
   * Mark running, then spawn as the owner. The manager admits (and claims the
   * desk) synchronously inside `spawn`, so the next task of this tick sees
   * that desk taken; the launch itself goes on in the background.
   */
  #start(task: TaskRow): void {
    const store = this.#store;
    const owner = this.ownerActor(task.createdBy);
    if (!owner) {
      store.finish(task.id, "cancelled", "its owner has left the office");
      return;
    }
    store.markRunning(task.id);
    let admitted = false;
    const input = spawnInput(task);
    const prompt = this.#deps.promptFor?.(task);
    const spawning = this.#deps.spawner.spawn(owner, prompt ? { ...input, prompt } : input, {
      onAdmitted: (agentId) => {
        admitted = true;
        store.setAgent(task.id, agentId);
      },
    });
    spawning.then(
      () => this.#deps.changed(task.operationId),
      (err: unknown) => {
        const message = safeMessage(err);
        this.#deps.logger.info({ taskId: task.id, err: message }, "queued task did not start");
        if (!admitted && err instanceof AgentManagerError && err.code === "conflict") {
          // Lost a desk race: wait in the same place; the periodic tick retries
          // (kicking now could loop on a desk the database still shows free).
          store.backToQueue(task.id, WAIT_REASONS.desk);
          this.#deps.changed(task.operationId);
          return;
        }
        if (store.finish(task.id, "failed", message)) this.#finished(task.id);
        this.#deps.changed(task.operationId);
        void this.kick(task.operationId);
      },
    );
  }

  /**
   * A henchman's status changed: a running task is done once its henchman finished
   * its turn (`done`, or idle straight after working: adapters without a
   * `done` signal), failed once its henchman
   * errors, stops or goes offline. Its slot frees and the room ticks.
   */
  agentStatus(
    agentId: string,
    status: AgentStatus,
    previous: AgentStatus,
    statusReason = "",
  ): void {
    const task = this.#store.runningFor(agentId);
    if (!task) return;
    let finished = false;
    if (status === "done" || (status === "idle" && previous === "working")) {
      finished = this.#store.finish(task.id, "done");
    } else if (status === "error") {
      finished = this.#store.finish(task.id, "failed", statusReason || FAIL_REASONS.error);
    } else if (status === "exited" || status === "offline") {
      finished = this.#store.finish(task.id, "failed", FAIL_REASONS[status]);
    }
    if (!finished) return;
    this.#finished(task.id);
    this.#deps.changed(task.operationId);
    void this.kick(task.operationId);
  }

  #finished(taskId: string): void {
    const task = this.#store.get(taskId);
    if (!task) return;
    try {
      this.#deps.finished?.(task);
    } catch (err) {
      this.#deps.logger.error({ taskId, err: String(err) }, "queue finish hook failed");
    }
  }

  /**
   * After an office restart (and after henchmen were re-adopted): running
   * tasks without a henchman go back to the queue; those whose henchman finished,
   * failed or is gone meanwhile are settled; the rest keep running.
   */
  recover(): Set<string> {
    const store = this.#store;
    store.prune();
    const touched = new Set<string>();
    for (const task of store.running()) {
      if (!task.agentId) {
        store.backToQueue(task.id, "");
        touched.add(task.operationId);
        continue;
      }
      const agent = store.db
        .select({ status: agents.status })
        .from(agents)
        .where(eq(agents.id, task.agentId))
        .get();
      const status = agent?.status;
      if (!status) store.finish(task.id, "failed", FAIL_REASONS.gone);
      else if (status === "done") store.finish(task.id, "done");
      else if (status === "error") store.finish(task.id, "failed", FAIL_REASONS.error);
      else if (status === "exited" || status === "offline") {
        store.finish(task.id, "failed", FAIL_REASONS[status]);
      } else continue;
      touched.add(task.operationId);
    }
    return touched;
  }

  /** Wait for ticks in flight (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.#ticks.size > 0) await Promise.all(this.#ticks.values());
  }
}

/** The spawn request a task stands for (checked again by the manager). */
export function spawnInput(task: TaskRow): SpawnInput {
  return {
    operationId: task.operationId,
    repoId: task.repoId ?? "",
    provider: task.provider,
    model: task.model,
    ...(task.effort ? { effort: task.effort } : {}),
    ...(task.permissionMode ? { permissionMode: task.permissionMode as PermissionMode } : {}),
    ...(task.profileId ? { profileId: task.profileId } : {}),
    prompt: task.prompt,
    taskTitle: task.title,
    ...(task.kind === "issue" && task.refNumber ? { issueNumber: task.refNumber } : {}),
    ...(task.kind === "pr" && task.refNumber ? { prNumber: task.refNumber } : {}),
    autoWorktree: task.autoWorktree,
  };
}

/** Manager errors carry client-safe messages; anything else does not. */
function safeMessage(err: unknown): string {
  return err instanceof AgentManagerError ? err.message.slice(0, 200) : FAIL_REASONS.start;
}
