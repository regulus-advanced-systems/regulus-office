import { describe, expect, test } from "bun:test";
import type { QueueTask } from "@regulus/protocol";
import type { SpawnPayload } from "../spawn/spawnForm.ts";
import {
  cardQueuePrefill,
  queuePayload,
  queueSections,
  taskActions,
  taskRef,
} from "./queueModel.ts";

const task = (over: Partial<QueueTask>): QueueTask => ({
  id: "t1",
  position: 0,
  kind: "freeform",
  refNumber: 0,
  repoId: "r1",
  title: "Task",
  prompt: "do it",
  provider: "claude-code",
  model: "opus",
  effort: "medium",
  permissionMode: "",
  autoWorktree: true,
  state: "queued",
  agentId: "",
  prNumber: 0,
  reason: "",
  createdBy: "u-mia",
  ownerName: "Mia",
  createdAt: 1,
  startedAt: 0,
  finishedAt: 0,
  ...over,
});

const spawn: SpawnPayload = {
  floorId: "f1",
  repoId: "r1",
  seatId: "queue",
  provider: "claude-code",
  model: "opus",
  effort: "medium",
  prompt: "",
  autoWorktree: true,
};

describe("queue model (#37)", () => {
  test("sections: queued in order, running, then history", () => {
    const s = queueSections([
      task({ id: "d", position: 3, state: "done" }),
      task({ id: "r", position: 2, state: "running" }),
      task({ id: "q2", position: 1 }),
      task({ id: "q1", position: 0 }),
    ]);
    expect([s.queued, s.running, s.finished].map((l) => l.map((t) => t.id))).toEqual([
      ["q1", "q2"],
      ["r"],
      ["d"],
    ]);
  });

  test("actions follow the server's ACL", () => {
    const mine = task({});
    expect(taskActions(mine, { id: "u-mia" }, "spawn", 1, 3)).toEqual({
      moveUp: true,
      moveDown: true,
      cancel: true,
      retry: false,
    });
    expect(taskActions(mine, { id: "u-otto" }, "spawn", 1, 3)).toEqual({
      moveUp: false,
      moveDown: false,
      cancel: false,
      retry: false,
    });
    // A room manager moves and cancels others' tasks, but never retries them.
    const failed = task({ state: "failed" });
    expect(taskActions(failed, { id: "u-max" }, "manage", 0, 1).retry).toBe(false);
    expect(taskActions(failed, { id: "u-mia" }, "spawn", 0, 1).retry).toBe(true);
    expect(taskActions(task({ state: "running" }), { id: "u-max" }, "manage", 0, 1).cancel).toBe(
      true,
    );
  });

  test("the form's payload becomes a queued task", () => {
    expect(queuePayload(spawn, undefined)).toEqual({
      ok: false,
      error: expect.stringContaining("needs a prompt"),
    });
    const freeform = queuePayload({ ...spawn, prompt: "Write docs", profileId: "p1" }, undefined);
    expect(freeform).toEqual({
      ok: true,
      payload: expect.objectContaining({ kind: "freeform", prompt: "Write docs", profileId: "p1" }),
    });
    const issue = queuePayload({ ...spawn, issueNumber: 7 }, undefined);
    expect(issue.ok && issue.payload).toMatchObject({ kind: "issue", refNumber: 7 });
    const pr = queuePayload({ ...spawn, taskTitle: "PR #9 x" }, { kind: "pr", refNumber: 9 });
    expect(pr.ok && pr.payload).toMatchObject({ kind: "pr", refNumber: 9, title: "PR #9 x" });
    expect(pr.ok && "seatId" in pr.payload).toBe(false);
  });

  test("a carried card becomes an issue or PR task", () => {
    const card = {
      kind: "issue" as const,
      repoId: "r1",
      number: 7,
      title: "Fix the lift doors",
      repo: "octo/hello",
      url: "",
      headBranch: "",
    };
    expect(cardQueuePrefill(card)).toEqual({
      kind: "issue",
      refNumber: 7,
      repoId: "r1",
      taskTitle: "#7 Fix the lift doors",
      prompt: "Work on issue #7 in octo/hello: Fix the lift doors",
    });
    expect(cardQueuePrefill({ ...card, kind: "pr" }).kind).toBe("pr");
    expect(taskRef({ kind: "pr", refNumber: 9 })).toBe("PR #9");
  });
});
