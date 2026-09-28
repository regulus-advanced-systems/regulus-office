import { describe, expect, test } from "bun:test";
import {
  AGENT_EVENT_KINDS,
  AgentEvent,
  LimitSample,
  parseAgentEvent,
  UsageSample,
} from "./agent-events.ts";

const ts = 1_700_000_000_000;

const valid: Record<(typeof AGENT_EVENT_KINDS)[number], unknown> = {
  status: { kind: "status", ts, status: "waiting_permission" },
  action: { kind: "action", ts, action: "running_tests", detail: "bun test" },
  message: { kind: "message", ts, role: "assistant", text: "Working on it", partial: true },
  tool_call: {
    kind: "tool_call",
    ts,
    callId: "c1",
    name: "Edit",
    toolKind: "edit",
    status: "completed",
    locations: ["packages/protocol/src/index.ts"],
  },
  permission_request: {
    kind: "permission_request",
    ts,
    requestId: "p1",
    toolName: "Bash",
    description: "rm -rf dist",
    options: ["allow_once", "reject"],
  },
  usage: {
    kind: "usage",
    ts,
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsdEstimate: 0.01,
    source: "inband",
  },
  limit: {
    kind: "limit",
    ts,
    windowKind: "five_hour",
    usedPct: 42.5,
    resetsAt: ts + 3_600_000,
    observedAt: ts,
    source: "statusline",
  },
  exit: { kind: "exit", ts, code: 0 },
};

describe("AgentEvent", () => {
  test("union covers every event kind", () => {
    const kinds = AgentEvent.options.map((o) => o.shape.kind.value);
    expect([...kinds].sort()).toEqual([...AGENT_EVENT_KINDS].sort());
  });

  test.each([...AGENT_EVENT_KINDS])("accepts a valid %s event", (kind) => {
    const result = parseAgentEvent(valid[kind]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe(kind);
  });

  test("rejects unknown kinds and bad enum values", () => {
    expect(parseAgentEvent({ kind: "heartbeat", ts }).success).toBe(false);
    expect(parseAgentEvent({ ...(valid.status as object), status: "busy" }).success).toBe(false);
    expect(parseAgentEvent({ ...(valid.action as object), action: "dance" }).success).toBe(false);
    expect(parseAgentEvent({ ...(valid.permission_request as object), options: [] }).success).toBe(
      false,
    );
    expect(parseAgentEvent({ ...(valid.tool_call as object), toolKind: "nuke" }).success).toBe(
      false,
    );
  });

  test("usage and limit samples validate ranges", () => {
    expect(UsageSample.safeParse({ ...(valid.usage as object), inputTokens: -1 }).success).toBe(
      false,
    );
    expect(LimitSample.safeParse({ ...(valid.limit as object), usedPct: 101 }).success).toBe(false);
    expect(UsageSample.safeParse({ ...(valid.usage as object), kind: undefined }).success).toBe(
      true,
    );
  });
});
