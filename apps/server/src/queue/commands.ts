/**
 * The OperationRoom's `queue.*` commands (SPEC §6; #37) and the AgentManager as
 * the queue's spawner. Refusals come back as a reason that is safe to show;
 * anything unexpected is logged and becomes "internal error".
 */
import type { ClientCommand, QueueCommandResult } from "@regulus/protocol";
import { AgentManagerError } from "../agents/manager/errors.ts";
import type { AgentManager } from "../agents/manager/manager.ts";
import type { OperationActor } from "../operations/access.ts";
import type { QueueSpawner } from "./scheduler.ts";
import { QueueError, type TaskQueue } from "./service.ts";

export type QueueCommand = Extract<
  ClientCommand,
  { type: "queue.add" | "queue.reorder" | "queue.cancel" | "queue.retry" | "queue.settings" }
>;

export type QueueOutcome = { ok: true; result: QueueCommandResult } | { ok: false; reason: string };

export function isQueueCommand(command: ClientCommand): command is QueueCommand {
  return command.type.startsWith("queue.");
}

/** Queue commands for the OperationRoom of `operationId`. */
export interface OperationQueueCommands {
  run(actor: OperationActor, operationId: string, command: QueueCommand): QueueOutcome;
}

function run(queue: TaskQueue, actor: OperationActor, operationId: string, command: QueueCommand) {
  switch (command.type) {
    case "queue.add": {
      if (command.operationId !== operationId)
        throw new QueueError("bad_request", "wrong operation");
      const { type: _type, ...input } = command;
      return queue.enqueueTask(actor, input).id;
    }
    case "queue.reorder":
      queue.reorder(actor, operationId, command.taskId, command.position);
      return command.taskId;
    case "queue.cancel":
      queue.cancel(actor, operationId, command.taskId);
      return command.taskId;
    case "queue.retry":
      queue.retry(actor, operationId, command.taskId);
      return command.taskId;
    case "queue.settings":
      queue.configure(actor, operationId, {
        maxRunning: command.maxRunning,
        maxPerOwner: command.maxPerOwner,
      });
      return "";
  }
}

export function operationQueueCommands(queue: TaskQueue, onError: (err: unknown) => void) {
  return {
    run(actor, operationId, command) {
      try {
        const taskId = run(queue, actor, operationId, command);
        return { ok: true, result: { type: command.type, taskId } };
      } catch (err) {
        if (err instanceof QueueError) return { ok: false, reason: err.message };
        onError(err);
        return { ok: false, reason: "internal error" };
      }
    },
  } satisfies OperationQueueCommands;
}

/** The AgentManager as the queue's spawner: tasks start through its normal admission. */
export function managerSpawner(manager: AgentManager): QueueSpawner {
  return {
    check(owner, input) {
      if (!manager.adapters.has(input.provider)) {
        throw new AgentManagerError("bad_request", `${input.provider} is not installed`);
      }
      // Throws when the profile is not the owner's own or an office key (SPEC §8).
      manager.credentials.check(owner.id, input.provider, input.profileId);
    },
    spawn: (owner, input, hooks) => manager.spawn(owner, input, hooks),
  };
}
