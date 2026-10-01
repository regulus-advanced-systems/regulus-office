/**
 * The room task queue (SPEC §5 `tasks`, §9.4 clipboard; #37): limits, the
 * server's answer to a `queue.*` command, and who may do what. No zod in the
 * ACL helpers, so the web bundle can import them on their own.
 *
 * Ownership (SPEC §8): the human who queues a task owns the henchman it spawns.
 * It runs with their credentials in their runner, and only while they may
 * still spawn on that operation; nobody else's credentials are ever used.
 *
 * - queue a task: operation `spawn` or `manage`;
 * - reorder or cancel: the task's owner, or a room manager (`manage`);
 * - retry: the task's owner only, while they may still spawn there, because
 *   a retry spends their credentials again;
 * - concurrency settings: room managers.
 */
import type { OperationAccess } from "./enums.ts";

export const QUEUE_RESULT_MESSAGE = "queue.result";

/** Bounds of both concurrency settings (room and per owner). */
export const QUEUE_LIMIT_MIN = 1;
export const QUEUE_LIMIT_MAX = 16;

/** Concurrency of a room that never changed its settings. */
export const DEFAULT_QUEUE_SETTINGS = { maxRunning: 2, maxPerOwner: 2 } as const;

/** Finished tasks (done, failed, cancelled) the room still shows, newest first. */
export const QUEUE_HISTORY_LIMIT = 20;

/** Sent to the caller when a `queue.*` command succeeded (failures are `command.rejected`). */
export interface QueueCommandResult {
  type: "queue.add" | "queue.reorder" | "queue.cancel" | "queue.retry" | "queue.settings";
  /** The task the command acted on ("" for `queue.settings`). */
  taskId: string;
}

export interface QueueActor {
  id: string;
}

const mayUse = (access: OperationAccess | null | undefined) =>
  access === "spawn" || access === "manage";

/** Put a task on this room's queue. */
export function mayQueueTask(access: OperationAccess | null | undefined): boolean {
  return mayUse(access);
}

/** Reorder or cancel a task: its owner (with any access) or a room manager. */
export function mayManageQueuedTask(
  actor: QueueActor | null | undefined,
  access: OperationAccess | null | undefined,
  task: { createdBy: string },
): boolean {
  if (!actor || !access) return false;
  return access === "manage" || task.createdBy === actor.id;
}

/** Retry a failed or cancelled task: only its owner, while they may spawn here. */
export function mayRetryTask(
  actor: QueueActor | null | undefined,
  access: OperationAccess | null | undefined,
  task: { createdBy: string },
): boolean {
  return Boolean(actor) && mayUse(access) && task.createdBy === actor?.id;
}

/** Change the room's concurrency settings. */
export function mayConfigureQueue(access: OperationAccess | null | undefined): boolean {
  return access === "manage";
}
