/**
 * The queue as the OperationRoom shows it (SPEC §6 channel 2 `OperationState.queue`,
 * `queueSettings`; #37): task rows become protocol `QueueTask`s, and the
 * OperationRoom's Colyseus state is made equal to them.
 */
import {
  type OperationStateSchema,
  type QueueSettings,
  QueueSettingsSchema,
  QueueTask,
  QueueTaskSchema,
} from "@regulus/protocol";
import type { TaskRow } from "./store.ts";

type OperationRoomState = InstanceType<typeof OperationStateSchema>;

const ms = (d: Date | null) => (d ? d.getTime() : 0);

export function toQueueTask(row: TaskRow, position: number, ownerName: string): QueueTask {
  return QueueTask.parse({
    id: row.id,
    position,
    kind: row.kind,
    refNumber: row.refNumber ?? 0,
    repoId: row.repoId ?? "",
    title: row.title,
    prompt: row.prompt,
    provider: row.provider,
    model: row.model,
    effort: row.effort ?? "",
    permissionMode: row.permissionMode ?? "",
    autoWorktree: row.autoWorktree,
    state: row.state,
    agentId: row.agentId ?? "",
    prNumber: row.prNumber ?? 0,
    reason: row.reason,
    createdBy: row.createdBy,
    ownerName: ownerName.slice(0, 64),
    createdAt: ms(row.createdAt),
    startedAt: ms(row.startedAt),
    finishedAt: ms(row.finishedAt),
  });
}

/** Make the room's `queue` and `queueSettings` equal these. */
export function syncQueue(
  state: OperationRoomState,
  tasks: readonly QueueTask[],
  settings: QueueSettings,
): void {
  while (state.queue.length > tasks.length) state.queue.pop();
  tasks.forEach((task, i) => {
    const existing = state.queue.at(i);
    const target = existing ?? new QueueTaskSchema();
    for (const [key, value] of Object.entries(task) as [keyof QueueTask, unknown][]) {
      if ((target as unknown as Record<string, unknown>)[key] !== value) {
        (target as unknown as Record<string, unknown>)[key] = value;
      }
    }
    if (!existing) state.queue.push(target);
  });
  if (!state.queueSettings) state.queueSettings = new QueueSettingsSchema();
  if (state.queueSettings.maxRunning !== settings.maxRunning) {
    state.queueSettings.maxRunning = settings.maxRunning;
  }
  if (state.queueSettings.maxPerOwner !== settings.maxPerOwner) {
    state.queueSettings.maxPerOwner = settings.maxPerOwner;
  }
}
