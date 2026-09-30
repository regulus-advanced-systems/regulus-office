/**
 * When a room's task queue (#37) empties (#43): the queue publishes every
 * change through `publishQueue`; this wraps that publisher and calls
 * `onEmptied(floorId)` when a room goes from open work (queued or running
 * tasks) to none, and at least one task finished `done`. A queue that was
 * only cancelled, or the first publish after a restart, does not ring.
 */
import type { QueueSettings, QueueTask } from "@regulus/protocol";

export interface QueuePublisherLike {
  publishQueue(floorId: string, tasks: readonly QueueTask[], settings: QueueSettings): void;
}

const isOpen = (t: QueueTask) => t.state === "queued" || t.state === "running";

export function watchQueueEmptied<P extends QueuePublisherLike>(
  publisher: P,
  onEmptied: (floorId: string) => void,
): P {
  const open = new Map<string, boolean>();
  return new Proxy(publisher, {
    get(target, key, receiver) {
      if (key !== "publishQueue") return Reflect.get(target, key, receiver);
      return (floorId: string, tasks: readonly QueueTask[], settings: QueueSettings) => {
        target.publishQueue(floorId, tasks, settings);
        const wasOpen = open.get(floorId);
        const nowOpen = tasks.some(isOpen);
        open.set(floorId, nowOpen);
        if (wasOpen === true && !nowOpen && tasks.some((t) => t.state === "done")) {
          try {
            onEmptied(floorId);
          } catch {
            // A ring is decoration; the queue must not notice.
          }
        }
      };
    },
  });
}
