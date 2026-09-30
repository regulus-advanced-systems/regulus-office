import { describe, expect, test } from "bun:test";
import { mayConfigureQueue, mayManageQueuedTask, mayQueueTask, mayRetryTask } from "./queue-api.ts";

const owner = { id: "u1" };
const other = { id: "u2" };
const task = { createdBy: "u1" };

describe("queue ACL (#37)", () => {
  test("queueing needs spawn or manage", () => {
    expect(mayQueueTask("spawn")).toBe(true);
    expect(mayQueueTask("manage")).toBe(true);
    expect(mayQueueTask("view")).toBe(false);
    expect(mayQueueTask(null)).toBe(false);
  });

  test("reorder and cancel: the task's owner or a room manager", () => {
    expect(mayManageQueuedTask(owner, "spawn", task)).toBe(true);
    expect(mayManageQueuedTask(owner, "view", task)).toBe(true);
    expect(mayManageQueuedTask(other, "manage", task)).toBe(true);
    expect(mayManageQueuedTask(other, "spawn", task)).toBe(false);
    expect(mayManageQueuedTask(other, "view", task)).toBe(false);
    expect(mayManageQueuedTask(owner, null, task)).toBe(false);
    expect(mayManageQueuedTask(null, "manage", task)).toBe(false);
  });

  test("retry spends the owner's credentials: the owner only, while they may spawn", () => {
    expect(mayRetryTask(owner, "spawn", task)).toBe(true);
    expect(mayRetryTask(owner, "view", task)).toBe(false);
    expect(mayRetryTask(other, "manage", task)).toBe(false);
  });

  test("settings are for room managers", () => {
    expect(mayConfigureQueue("manage")).toBe(true);
    expect(mayConfigureQueue("spawn")).toBe(false);
  });
});
