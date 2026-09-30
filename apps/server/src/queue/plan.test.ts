import { describe, expect, test } from "bun:test";
import { planQueue, WAIT_REASONS } from "./plan.ts";

const task = (id: string, createdBy = "u1") => ({ id, createdBy });
const base = {
  running: [],
  settings: { maxRunning: 2, maxPerOwner: 2 },
  freeDesks: 4,
  ownerMaySpawn: () => true,
};

describe("planQueue (#37)", () => {
  test("starts in queue order up to the room's slots", () => {
    const plan = planQueue({ ...base, queued: [task("a"), task("b"), task("c")] });
    expect(plan.start).toEqual(["a", "b"]);
    expect(plan.waiting.get("c")).toBe(WAIT_REASONS.slot);
  });

  test("running tasks take slots", () => {
    const plan = planQueue({
      ...base,
      settings: { maxRunning: 1, maxPerOwner: 2 },
      running: [task("r")],
      queued: [task("a")],
    });
    expect(plan.start).toEqual([]);
    expect(plan.waiting.get("a")).toBe(WAIT_REASONS.slot);
  });

  test("an owner at their limit does not hold up other owners", () => {
    const plan = planQueue({
      ...base,
      settings: { maxRunning: 3, maxPerOwner: 1 },
      running: [task("r", "u1")],
      queued: [task("a", "u1"), task("b", "u2"), task("c", "u2")],
    });
    expect(plan.start).toEqual(["b"]);
    expect(plan.waiting.get("a")).toBe(WAIT_REASONS.owner);
    expect(plan.waiting.get("c")).toBe(WAIT_REASONS.owner);
  });

  test("no free desk holds everything", () => {
    const plan = planQueue({ ...base, freeDesks: 1, queued: [task("a"), task("b", "u2")] });
    expect(plan.start).toEqual(["a"]);
    expect(plan.waiting.get("b")).toBe(WAIT_REASONS.desk);
  });

  test("a task whose owner may no longer spawn is on hold and skipped", () => {
    const plan = planQueue({
      ...base,
      queued: [task("a", "gone"), task("b", "u2")],
      ownerMaySpawn: (id) => id !== "gone",
    });
    expect(plan.start).toEqual(["b"]);
    expect(plan.waiting.get("a")).toBe(WAIT_REASONS.access);
  });
});
