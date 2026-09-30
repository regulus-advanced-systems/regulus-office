/** The task queue emptying rings the gong (#43 with #37): only on a real transition to empty. */
import { describe, expect, test } from "bun:test";
import type { QueueSettings, QueueTask } from "@regulus/protocol";
import { watchQueueEmptied } from "./queue-watch.ts";

const settings = {} as QueueSettings;
const task = (id: string, state: QueueTask["state"]) => ({ id, state }) as unknown as QueueTask;

function setup() {
  const published: string[] = [];
  const rang: string[] = [];
  const rooms = {
    publishQueue: (floorId: string, _t: readonly QueueTask[], _s: QueueSettings) =>
      void published.push(floorId),
    other: () => "kept",
  };
  const watched = watchQueueEmptied(rooms, (id) => rang.push(id));
  return { watched, published, rang };
}

describe("watchQueueEmptied", () => {
  test("open work finishing rings once; the publish still goes through", () => {
    const s = setup();
    s.watched.publishQueue("f1", [task("a", "queued"), task("b", "running")], settings);
    s.watched.publishQueue("f1", [task("a", "running"), task("b", "done")], settings);
    expect(s.rang).toEqual([]);
    s.watched.publishQueue("f1", [task("a", "failed"), task("b", "done")], settings);
    s.watched.publishQueue("f1", [task("a", "failed"), task("b", "done")], settings);
    expect(s.rang).toEqual(["f1"]);
    expect(s.published).toHaveLength(4);
    expect(s.watched.other()).toBe("kept");
  });

  test("no ring after a restart, for a cancelled-only queue, or on another floor", () => {
    const s = setup();
    s.watched.publishQueue("f1", [task("a", "done")], settings);
    s.watched.publishQueue("f2", [task("c", "queued")], settings);
    s.watched.publishQueue("f2", [task("c", "cancelled")], settings);
    expect(s.rang).toEqual([]);
  });

  test("a throwing ring never breaks the queue's publish", () => {
    const published: string[] = [];
    const watched = watchQueueEmptied(
      {
        publishQueue: (id: string, _t: readonly QueueTask[], _s: QueueSettings) =>
          void published.push(id),
      },
      () => {
        throw new Error("boom");
      },
    );
    watched.publishQueue("f1", [task("a", "running")], settings);
    expect(() => watched.publishQueue("f1", [task("a", "done")], settings)).not.toThrow();
    expect(published).toEqual(["f1", "f1"]);
  });
});
