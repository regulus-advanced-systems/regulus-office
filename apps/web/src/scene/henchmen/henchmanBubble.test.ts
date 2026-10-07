import { describe, expect, test } from "bun:test";
import type { AgentBubble } from "@regulus/protocol";
import { bubbleForViewer } from "./henchmanBubble.ts";

const henchmanFixture = {
  ownerUserId: "u1",
  ownerName: "Mia",
  bubble: {
    kind: "doing",
    text: "editing state.ts",
    targetKind: "none",
    targetId: "",
  } satisfies AgentBubble as AgentBubble,
};

const waiting = {
  ...henchmanFixture,
  ownerUserId: "u1",
  ownerName: "Mia",
  bubble: {
    kind: "needs_you" as const,
    text: "waiting for you: approve a command",
    targetKind: "permission" as const,
    targetId: "a1",
  },
};

describe("a henchman's bubble per viewer", () => {
  test("the owner reads 'waiting for you'; others read who it waits for", () => {
    expect(bubbleForViewer(waiting, "u1")).toBe(waiting.bubble);
    expect(bubbleForViewer(waiting, "u2")).toEqual({
      ...waiting.bubble,
      text: "waiting for Mia: approve a command",
    });
    expect(bubbleForViewer({ ...waiting, ownerName: " " }, "u2").text).toBe(
      "waiting for its owner: approve a command",
    );
    // Not signed in yet (the dev harness): as the server worded it.
    expect(bubbleForViewer(waiting, null)).toBe(waiting.bubble);
  });

  test("activity and other texts are the same for everyone", () => {
    expect(bubbleForViewer(henchmanFixture, "someone")).toBe(henchmanFixture.bubble);
    const error = {
      ...waiting,
      bubble: { ...waiting.bubble, text: "hit an error: take a look" },
    };
    expect(bubbleForViewer(error, "u2").text).toBe("hit an error: take a look");
  });
});
