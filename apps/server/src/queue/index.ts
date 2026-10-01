/**
 * The room task queue (issue #37; SPEC §5 `tasks`, §9.4 clipboard).
 *
 * - service.ts   TaskQueue: `enqueueTask` (server API, also for #155), reorder,
 *                cancel, retry, settings with their ACL; PR linking; boot
 * - scheduler.ts starts tasks as their owner when a slot and a desk are free,
 *                follows their henchmen, restart recovery
 * - plan.ts      which queued tasks start now (pure)
 * - store.ts     `tasks` and `operation_queue_settings`
 * - content.ts   titles and prompts for issue / PR tasks
 * - pr-link.ts   the PR a task's henchman opened (office, event bus, cache)
 * - publish.ts   rows → `OperationState.queue` / `queueSettings`
 * - commands.ts  the OperationRoom's `queue.*` commands; the AgentManager as spawner
 */
import type { AgentManager } from "../agents/manager/manager.ts";
import type { AgentObserver } from "../agents/manager/runtime.ts";
import type { Db } from "../db/index.ts";
import type { Logger } from "../logging.ts";
import { managerSpawner, operationQueueCommands } from "./commands.ts";
import type { QueueSpawner } from "./scheduler.ts";
import { type QueuePublisher, TaskQueue } from "./service.ts";

export { type EnqueueInput, QueueError, TaskQueue } from "./service.ts";

export interface TaskQueueBoot {
  queue: TaskQueue;
  /** Hand the queue its spawner once the AgentManager exists. */
  bind(manager: AgentManager): void;
}

/**
 * The queue, created before the AgentManager (which needs `queue.observer`)
 * and bound to it right after; nothing starts until `queue.boot()`.
 */
export function createTaskQueue(opts: {
  db: Db;
  rooms: QueuePublisher & {
    setQueueCommands(commands: ReturnType<typeof operationQueueCommands>): void;
  };
  logger: Logger;
}): TaskQueueBoot {
  let spawner: QueueSpawner | undefined;
  const bound = (): QueueSpawner => {
    if (!spawner) throw new Error("the task queue has no spawner yet");
    return spawner;
  };
  const queue = new TaskQueue({
    db: opts.db,
    publisher: opts.rooms,
    logger: opts.logger,
    spawner: {
      check: (owner, input) => bound().check(owner, input),
      spawn: (owner, input, hooks) => bound().spawn(owner, input, hooks),
    },
  });
  opts.rooms.setQueueCommands(
    operationQueueCommands(queue, (err) =>
      opts.logger.error({ err: String(err) }, "queue command failed"),
    ),
  );
  return {
    queue,
    bind(manager) {
      spawner = managerSpawner(manager);
    },
  };
}

/** Several observers as one; one failing does not stop the others (the manager logs it). */
export function allObservers(...list: Array<AgentObserver | undefined>): AgentObserver {
  const present = list.filter((o): o is AgentObserver => o !== undefined);
  const each = (fn: (o: AgentObserver) => void) => {
    let first: unknown;
    for (const o of present) {
      try {
        fn(o);
      } catch (err) {
        first ??= err;
      }
    }
    if (first) throw first;
  };
  return {
    statusChanged: (view, previous) => each((o) => o.statusChanged(view, previous)),
    pullRequestOpened: (view, pr) => each((o) => o.pullRequestOpened(view, pr)),
  };
}
