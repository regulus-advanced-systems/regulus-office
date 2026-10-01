/**
 * The room task queue, client side (#37): how the panel groups tasks, which
 * buttons a human gets (the same ACL the server enforces, protocol
 * queue-api.ts), and the `queue.add` payload built from the spawn form. Pure.
 */
import {
  type ClientCommandPayload,
  mayManageQueuedTask,
  mayRetryTask,
  type OperationAccess,
  parseClientCommand,
  type QueueTask,
  type TaskState,
} from "@regulus/protocol";
import type { SpawnPrefill } from "../../state/spawn.ts";
import { type CarriedView, carriedPrefill } from "../boards/carry.ts";
import type { SpawnPayload } from "../spawn/spawnForm.ts";
import type { QueuePrefill } from "./queueStore.ts";

export type QueueAddPayload = ClientCommandPayload<"queue.add">;

export const STATE_LABELS: Record<TaskState, string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export interface QueueSections {
  queued: QueueTask[];
  running: QueueTask[];
  finished: QueueTask[];
}

/** Queued in run order, running, then recent history (as the server orders them). */
export function queueSections(tasks: readonly QueueTask[]): QueueSections {
  const sorted = [...tasks].sort((a, b) => a.position - b.position);
  return {
    queued: sorted.filter((t) => t.state === "queued"),
    running: sorted.filter((t) => t.state === "running"),
    finished: sorted.filter((t) => t.state !== "queued" && t.state !== "running"),
  };
}

export interface TaskActions {
  moveUp: boolean;
  moveDown: boolean;
  cancel: boolean;
  retry: boolean;
}

/** Buttons for one task; `index`/`count` are its place among the queued tasks. */
export function taskActions(
  task: QueueTask,
  me: { id: string } | null,
  access: OperationAccess | null,
  index: number,
  count: number,
): TaskActions {
  const manage = mayManageQueuedTask(me, access, task);
  const queued = task.state === "queued";
  return {
    moveUp: manage && queued && index > 0,
    moveDown: manage && queued && index < count - 1,
    cancel: manage && (queued || task.state === "running"),
    retry:
      mayRetryTask(me, access, task) && (task.state === "failed" || task.state === "cancelled"),
  };
}

/** Short tag for a task's origin: `#7`, `PR #9` or `Freeform`. */
export function taskRef(task: Pick<QueueTask, "kind" | "refNumber">): string {
  if (task.kind === "issue") return `#${task.refNumber}`;
  if (task.kind === "pr") return `PR #${task.refNumber}`;
  return "Freeform";
}

/** What the spawn form starts with for a queued task. */
export function spawnPrefillFor(prefill: QueuePrefill | undefined): SpawnPrefill | undefined {
  if (!prefill) return undefined;
  return {
    repoId: prefill.repoId,
    ...(prefill.kind === "issue" && prefill.refNumber ? { issueNumber: prefill.refNumber } : {}),
    taskTitle: prefill.taskTitle,
    prompt: prefill.prompt,
  };
}

/** A card carried to the clipboard: an issue or PR task with the card's title and prompt. */
export function cardQueuePrefill(card: CarriedView): QueuePrefill {
  const spawn = carriedPrefill(card);
  return {
    kind: card.kind === "pr" ? "pr" : "issue",
    refNumber: card.number,
    repoId: card.repoId,
    taskTitle: spawn.taskTitle,
    prompt: spawn.prompt,
  };
}

export type QueueValidation = { ok: true; payload: QueueAddPayload } | { ok: false; error: string };

/**
 * The spawn form's (validated) payload as a queued task. A PR card keeps its
 * kind; an issue number typed in the form makes an issue task; otherwise it
 * is freeform and needs a prompt.
 */
export function queuePayload(
  spawn: SpawnPayload,
  prefill: QueuePrefill | undefined,
): QueueValidation {
  const pr = prefill?.kind === "pr" && prefill.refNumber ? prefill.refNumber : undefined;
  const issue = spawn.issueNumber;
  const kind = pr ? "pr" : issue ? "issue" : "freeform";
  if (kind === "freeform" && !spawn.prompt) {
    return { ok: false, error: "A queued task needs a prompt (under More options), or an issue." };
  }
  const payload: QueueAddPayload = {
    operationId: spawn.operationId,
    repoId: spawn.repoId,
    kind,
    ...(pr ? { refNumber: pr } : issue ? { refNumber: issue } : {}),
    ...(spawn.taskTitle ? { title: spawn.taskTitle } : {}),
    prompt: spawn.prompt,
    provider: spawn.provider,
    model: spawn.model,
    ...(spawn.effort ? { effort: spawn.effort } : {}),
    ...(spawn.permissionMode ? { permissionMode: spawn.permissionMode } : {}),
    ...(spawn.profileId ? { profileId: spawn.profileId } : {}),
    autoWorktree: spawn.autoWorktree,
  };
  const parsed = parseClientCommand("queue.add", payload);
  if (!parsed.success) return { ok: false, error: "This task is not accepted." };
  return { ok: true, payload };
}
