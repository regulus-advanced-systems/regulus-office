import { describe, expect, test } from "bun:test";
import {
  AGENT_BUBBLE_MAX_TEXT,
  AgentBubble,
  agentBubbleAsks,
  agentBubbleShown,
  NO_AGENT_BUBBLE,
} from "./agent-bubble.ts";
import { BuildingState, HumanPresence } from "./building-state.ts";
import { buildingFixture, henchmanFixture, humanFixture, operationFixture } from "./fixtures.ts";
import { henchmanDisplayName } from "./notifications.ts";
import { boardCardKey, HenchmanState, OperationState } from "./operation-state.ts";

describe("state shapes", () => {
  test("building fixture validates and round-trips unchanged", () => {
    const result = BuildingState.safeParse(buildingFixture);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(buildingFixture);
  });

  test("operation fixture validates and round-trips unchanged", () => {
    const result = OperationState.safeParse(operationFixture);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(operationFixture);
  });

  test("rejects enum values outside the shared lists", () => {
    expect(HumanPresence.safeParse({ ...humanFixture, role: "root" }).success).toBe(false);
    expect(HenchmanState.safeParse({ ...henchmanFixture, status: "busy" }).success).toBe(false);
    expect(HenchmanState.safeParse({ ...henchmanFixture, action: "dancing" }).success).toBe(false);
  });

  test("rejects negative counters and non-finite positions", () => {
    expect(HenchmanState.safeParse({ ...henchmanFixture, issueNumber: -1 }).success).toBe(false);
    const pos = { ...humanFixture.position, x: Number.NaN };
    expect(HumanPresence.safeParse({ ...humanFixture, position: pos }).success).toBe(false);
  });

  test("board card key matches fixture keys", () => {
    expect(boardCardKey("r1", 8)).toBe("r1#8");
    expect(Object.keys(operationFixture.issues)).toContain(boardCardKey("r1", 8));
  });
});

describe("agent bubble and names (#256)", () => {
  test("the bubble shape: kinds, a short text, a click target", () => {
    expect(
      AgentBubble.safeParse({
        kind: "needs_you",
        text: "waiting for you: approve a command",
        targetKind: "permission",
        targetId: "a1",
      }).success,
    ).toBe(true);
    expect(AgentBubble.safeParse(NO_AGENT_BUBBLE).success).toBe(true);
    expect(AgentBubble.safeParse({ ...NO_AGENT_BUBBLE, kind: "shouting" }).success).toBe(false);
    expect(
      AgentBubble.safeParse({ ...NO_AGENT_BUBBLE, text: "x".repeat(AGENT_BUBBLE_MAX_TEXT + 1) })
        .success,
    ).toBe(false);
  });

  test("shown and asking: only a kind with a text shows; 'doing' does not ask", () => {
    const doing = { kind: "doing", text: "reading auth.ts", targetKind: "none", targetId: "" };
    expect(agentBubbleShown(AgentBubble.parse(doing))).toBe(true);
    expect(agentBubbleAsks(AgentBubble.parse(doing))).toBe(false);
    expect(agentBubbleAsks(AgentBubble.parse({ ...doing, kind: "needs_you" }))).toBe(true);
    expect(agentBubbleAsks(AgentBubble.parse({ ...doing, kind: "answer_ready" }))).toBe(true);
    expect(agentBubbleShown(NO_AGENT_BUBBLE)).toBe(false);
    expect(agentBubbleShown(AgentBubble.parse({ ...doing, text: "" }))).toBe(false);
    expect(agentBubbleShown(undefined)).toBe(false);
  });

  test("a henchman is named by its own name, with whose it is", () => {
    expect(henchmanDisplayName("Ada", "codex", "Gasket")).toBe("Gasket, Ada's Codex henchman");
    expect(henchmanDisplayName("Ada", "codex")).toBe("Ada's Codex henchman");
    expect(henchmanDisplayName("", "claude-code", " ")).toBe("Someone's Claude Code henchman");
  });
});
