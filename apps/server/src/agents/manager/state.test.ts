/** State machine, RobotState reducer and the heuristic rungs of the status ladder. */
import { describe, expect, test } from "bun:test";
import { AGENT_STATUSES, type AgentEvent, RobotState } from "@regulus/protocol";
import { deriveHeuristicStatus } from "./ladder.ts";
import { type AgentView, applyEvent, robotState, setStatus } from "./robot.ts";
import { canTransition, handRaised, isLive, transition } from "./state-machine.ts";

function view(overrides: Partial<AgentView> = {}): AgentView {
  return {
    agentId: "a1",
    floorId: "f1",
    repoId: "r1",
    seatId: "seat-1",
    ownerUserId: "u1",
    ownerName: "Olga",
    provider: "claude-code",
    model: "m",
    effort: "",
    status: "starting",
    statusReason: "",
    action: "none",
    taskTitle: "t",
    taskSummary: "",
    issueNumber: 0,
    prNumber: 0,
    worktreeBranch: "",
    lastActivityAt: 0,
    bubbles: { toolCalls: 0, fileEdits: 0, testRuns: 0, toolFailures: 0 },
    seenCalls: new Set(),
    failedCalls: new Set(),
    ...overrides,
  };
}

describe("state machine", () => {
  test("the normal lifecycle is allowed", () => {
    const path = ["starting", "idle", "working", "waiting_permission", "working", "done", "exited"];
    for (let i = 1; i < path.length; i++) {
      expect(canTransition(path[i - 1] as never, path[i] as never)).toBe(true);
    }
  });

  test("exited only leaves through starting (resume)", () => {
    for (const to of AGENT_STATUSES) {
      expect(canTransition("exited", to)).toBe(to === "exited" || to === "starting");
    }
    expect(transition("exited", "working")).toEqual({
      status: "exited",
      changed: false,
      refused: true,
    });
  });

  test("a running agent cannot go back to starting; offline and error can", () => {
    expect(canTransition("working", "starting")).toBe(false);
    expect(canTransition("idle", "starting")).toBe(false);
    expect(canTransition("offline", "starting")).toBe(true);
    expect(canTransition("error", "starting")).toBe(true);
    expect(canTransition("offline", "idle")).toBe(true);
  });

  test("helpers", () => {
    expect(handRaised("waiting_input")).toBe(true);
    expect(handRaised("working")).toBe(false);
    expect(isLive("working")).toBe(true);
    expect(isLive("exited")).toBe(false);
    expect(isLive("offline")).toBe(false);
  });
});

describe("robot reducer", () => {
  const ts = 1000;

  test("permission requests raise the hand and events drive actions and bubbles", () => {
    const v = view();
    const events: AgentEvent[] = [
      { kind: "status", ts, status: "working" },
      { kind: "tool_call", ts, callId: "c1", name: "Read", toolKind: "read", status: "running" },
      { kind: "tool_call", ts, callId: "c1", name: "Read", toolKind: "read", status: "completed" },
      {
        kind: "tool_call",
        ts,
        callId: "c2",
        name: "Bash",
        toolKind: "execute",
        status: "running",
        summary: "bun test",
      },
    ];
    for (const e of events) applyEvent(v, e, 5);
    expect(v.action).toBe("running_tests");
    expect(v.bubbles).toEqual({ toolCalls: 2, fileEdits: 0, testRuns: 1, toolFailures: 0 });

    applyEvent(
      v,
      { kind: "tool_call", ts, callId: "c2", name: "Bash", toolKind: "execute", status: "failed" },
      6,
    );
    expect(v.bubbles.toolFailures).toBe(1);
    expect(v.action).toBe("failing");

    const r = applyEvent(
      v,
      {
        kind: "permission_request",
        ts,
        requestId: "p1",
        toolName: "Bash",
        description: "rm",
        options: ["allow_once", "reject"],
      },
      7,
    );
    expect(r.statusChanged).toBe(true);
    const robot = RobotState.parse(robotState(v));
    expect(robot).toMatchObject({ status: "waiting_permission", handRaised: true, action: "none" });

    applyEvent(v, { kind: "status", ts, status: "done" }, 8);
    expect(v.action).toBe("celebrating");
    expect(v.lastActivityAt).toBe(8);
  });

  test("exit settles the robot and later events are refused", () => {
    const v = view({ status: "working" });
    expect(applyEvent(v, { kind: "exit", ts, code: 0 }, 1).statusChanged).toBe(true);
    const late = applyEvent(v, { kind: "status", ts, status: "working" }, 2);
    expect(late).toEqual({
      statusChanged: false,
      robotChanged: false,
      refused: { from: "exited", to: "working" },
    });
    applyEvent(v, { kind: "action", ts, action: "typing" }, 3);
    expect(v.action).toBe("none");
    expect(setStatus(v, "starting", 4)).toBe(true);
  });

  test("an error shows its redacted reason until the robot leaves error", () => {
    const v = view();
    const reason = "runner_api: Docker Engine: POST /containers/x/start: 500 no such file";
    applyEvent(v, { kind: "status", ts, status: "error", reason }, 1);
    expect(robotState(v)).toMatchObject({
      status: "error",
      action: "failing",
      statusReason: "runner_api: Docker Engine: POST <path>: 500 no such file",
    });
    expect(RobotState.safeParse(robotState(v)).success).toBe(true);
    applyEvent(v, { kind: "status", ts, status: "working" }, 2);
    expect(robotState(v).statusReason).toBe("");
    applyEvent(v, { kind: "status", ts, status: "error" }, 3);
    expect(robotState(v).statusReason).toBe("");
    applyEvent(v, { kind: "status", ts, status: "error", reason: "boom" }, 4);
    expect(v.statusReason).toBe("");
    v.statusReason = "stale";
    expect(setStatus(v, "starting", 5)).toBe(true);
    expect(robotState(v).statusReason).toBe("");
  });

  test("usage does not count as activity", () => {
    const v = view({ status: "idle", lastActivityAt: 1 });
    const r = applyEvent(
      v,
      {
        kind: "usage",
        ts,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        source: "statusline",
      },
      50,
    );
    expect(r.robotChanged).toBe(false);
    expect(v.lastActivityAt).toBe(1);
  });
});

describe("status ladder heuristics", () => {
  const base = { title: "", pane: "", paneChanged: false, quietMs: 0 };

  test("OSC title wins over pane text", () => {
    expect(deriveHeuristicStatus({ ...base, title: "fake-agent: working", pane: "(y/n)" })).toEqual(
      { status: "working", rung: "title" },
    );
    expect(deriveHeuristicStatus({ ...base, title: "fake-agent: idle" })?.status).toBe("idle");
    expect(deriveHeuristicStatus({ ...base, title: "⠙ Claude" })?.status).toBe("working");
  });

  test("capture-pane regexes, then activity", () => {
    expect(deriveHeuristicStatus({ ...base, pane: "Do you want to proceed?\n 1. Yes" })).toEqual({
      status: "waiting_permission",
      rung: "pane",
    });
    expect(deriveHeuristicStatus({ ...base, pane: "… (esc to interrupt)" })?.status).toBe(
      "working",
    );
    expect(deriveHeuristicStatus({ ...base, pane: "x", paneChanged: true })).toEqual({
      status: "working",
      rung: "activity",
    });
    expect(deriveHeuristicStatus({ ...base, pane: "x", quietMs: 20_000 })?.status).toBe("idle");
    expect(deriveHeuristicStatus({ ...base, pane: "x", quietMs: 10 })).toBeUndefined();
  });
});
