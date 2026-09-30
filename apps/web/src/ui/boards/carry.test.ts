import { describe, expect, test } from "bun:test";
import type { FloorState } from "@regulus/protocol";
import { floorFixture } from "@regulus/protocol/src/fixtures.ts";
import { carriedPrefill, carriedView, dropCard, myCarried, pickCard } from "./carry.ts";

function floor(): FloorState {
  const base = structuredClone(floorFixture);
  return {
    ...base,
    repos: [{ repoId: "r1", owner: "octo", name: "hello", defaultBranch: "main", isPrimary: true }],
    issues: {
      "r1#7": {
        repoId: "r1",
        number: 7,
        title: "Fix the login bug",
        state: "open",
        labels: [],
        assignees: [],
        author: "olga",
        url: "https://github.com/octo/hello/issues/7",
        updatedAt: 1,
      },
    },
    pulls: {
      "r1#9": {
        repoId: "r1",
        number: 9,
        title: "Speed up tests",
        state: "open",
        labels: [],
        assignees: [],
        author: "robot",
        url: "https://github.com/octo/hello/pull/9",
        updatedAt: 1,
        draft: false,
        merged: false,
        headBranch: "office/speed",
        checksState: "pending",
        reviewState: "none",
      },
    },
    carriedCards: {
      s1: {
        sessionId: "s1",
        userId: "u-ada",
        cardKind: "issue",
        repoId: "r1",
        number: 7,
        pickedAt: 1,
      },
      s2: {
        sessionId: "s2",
        userId: "u-ben",
        cardKind: "pr",
        repoId: "r1",
        number: 9,
        pickedAt: 2,
      },
    },
  };
}

describe("carried cards", () => {
  test("the user's own card is found by user id", () => {
    const state = floor();
    expect(myCarried(state, "u-ada")?.number).toBe(7);
    expect(myCarried(state, "u-ben")?.cardKind).toBe("pr");
    expect(myCarried(state, "u-cy")).toBeNull();
    expect(myCarried(null, "u-ada")).toBeNull();
  });

  test("an issue card prefills repo, issue, title and prompt", () => {
    const state = floor();
    const card = carriedView(state, myCarried(state, "u-ada") as never);
    expect(carriedPrefill(card)).toEqual({
      repoId: "r1",
      issueNumber: 7,
      taskTitle: "#7 Fix the login bug",
      prompt:
        "Work on issue #7 in octo/hello: Fix the login bug\n\nhttps://github.com/octo/hello/issues/7",
    });
  });

  test("a PR card prefills repo, title and a prompt naming its branch, but no issue", () => {
    const state = floor();
    const prefill = carriedPrefill(carriedView(state, myCarried(state, "u-ben") as never));
    expect(prefill.issueNumber).toBeUndefined();
    expect(prefill.taskTitle).toBe("PR #9 Speed up tests");
    expect(prefill.prompt).toContain("pull request #9 (branch office/speed) in octo/hello");
  });

  test("a card that has left the board still prefills what is known", () => {
    const state = { ...floor(), issues: {} };
    const view = carriedView(state, myCarried(state, "u-ada") as never);
    expect(view.title).toBe("");
    expect(carriedPrefill(view).taskTitle).toBe("#7");
  });

  test("long titles are clipped to the spawn form's limit", () => {
    const state = floor();
    const issue = state.issues["r1#7"];
    if (issue) issue.title = "x".repeat(300);
    const prefill = carriedPrefill(carriedView(state, myCarried(state, "u-ada") as never));
    expect(prefill.taskTitle?.length).toBe(200);
  });

  test("pick and drop send the floor commands; a missing room is not fatal", () => {
    const sent: unknown[] = [];
    const send = ((type: string, payload: unknown) => sent.push({ type, payload })) as never;
    expect(pickCard({ kind: "pr", repoId: "r1", number: 9 }, send)).toBe(true);
    dropCard("desk-a-s1", send);
    dropCard(undefined, send);
    expect(sent).toEqual([
      { type: "card.pick", payload: { cardKind: "pr", repoId: "r1", number: 9 } },
      { type: "card.drop", payload: { seatId: "desk-a-s1" } },
      { type: "card.drop", payload: {} },
    ]);
    const failing = (() => {
      throw new Error("floor room not joined");
    }) as never;
    expect(pickCard({ kind: "issue", repoId: "r1", number: 7 }, failing)).toBe(false);
    expect(() => dropCard("x", failing)).not.toThrow();
  });
});
