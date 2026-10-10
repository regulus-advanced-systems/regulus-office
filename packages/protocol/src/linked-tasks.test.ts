import { describe, expect, test } from "bun:test";
import type { TaskState } from "./enums.ts";
import {
  CreateLinkedTaskRequest,
  LINKED_TASK_PARTS_MAX,
  type LinkedPullState,
  linkedPullsState,
  linkedTaskSummary,
  linkedWorkState,
} from "./linked-tasks.ts";

const part = (state: TaskState, prState: LinkedPullState = "none") => ({ state, prState });

describe("linked tasks (#257)", () => {
  test("a request names two to six rooms and a prompt", () => {
    const base = { prompt: "do it", provider: "claude-code", model: "opus" };
    expect(CreateLinkedTaskRequest.safeParse({ ...base, operationIds: ["a"] }).success).toBe(false);
    expect(CreateLinkedTaskRequest.safeParse({ ...base, operationIds: ["a", "b"] }).success).toBe(
      true,
    );
    const many = Array.from({ length: LINKED_TASK_PARTS_MAX + 1 }, (_, i) => `r${i}`);
    expect(CreateLinkedTaskRequest.safeParse({ ...base, operationIds: many }).success).toBe(false);
    expect(
      CreateLinkedTaskRequest.safeParse({ ...base, prompt: " ", operationIds: ["a", "b"] }).success,
    ).toBe(false);
    // Review 7: private repos are not named unless asked; a worktree per part is not a choice.
    const parsed = CreateLinkedTaskRequest.parse({ ...base, operationIds: ["a", "b"] });
    expect(parsed.namePrivateRepos).toBe(false);
    expect("autoWorktree" in parsed).toBe(false);
  });

  test("work: queued, working, finished, or needing attention", () => {
    expect(linkedWorkState([part("queued"), part("queued")])).toBe("queued");
    expect(linkedWorkState([part("queued"), part("running")])).toBe("working");
    expect(linkedWorkState([part("done"), part("queued")])).toBe("working");
    expect(linkedWorkState([part("failed"), part("running")])).toBe("working");
    expect(linkedWorkState([part("done"), part("done")])).toBe("finished");
    expect(linkedWorkState([part("done"), part("failed")])).toBe("attention");
    expect(linkedWorkState([part("cancelled"), part("cancelled")])).toBe("attention");
  });

  test("pull requests as one state: all open, some merged, all merged", () => {
    expect(linkedPullsState([part("running"), part("running")])).toBe("none");
    expect(linkedPullsState([part("done", "draft"), part("running")])).toBe("some_open");
    expect(linkedPullsState([part("done", "draft"), part("done", "open")])).toBe("all_open");
    expect(linkedPullsState([part("done", "merged"), part("done", "open")])).toBe("some_merged");
    expect(linkedPullsState([part("done", "merged"), part("done", "merged")])).toBe("all_merged");
    expect(linkedPullsState([part("done", "closed"), part("done", "closed")])).toBe("none");
  });

  test("the one-line summary counts only the parts it is given", () => {
    expect(linkedTaskSummary([part("done", "merged"), part("done", "open"), part("failed")])).toBe(
      "1 of 3 merged · 1 part failed",
    );
    expect(linkedTaskSummary([part("done", "merged"), part("done", "merged")])).toBe("all merged");
    expect(linkedTaskSummary([part("done", "open"), part("cancelled")])).toBe(
      "1 of 2 pull requests open · 1 stopped",
    );
    expect(linkedTaskSummary([part("running"), part("queued")])).toBe("no pull requests yet");
  });
});
