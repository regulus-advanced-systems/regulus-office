import { describe, expect, test } from "bun:test";
import { approvalResponse } from "./approvals.ts";
import type { ApprovalRequest } from "./events.ts";
import { CodexEventMapper } from "./events.ts";
import { itemAction, looksLikeTests } from "./items.ts";
import { limitSamples, TokenUsageTracker, windowKind } from "./usage.ts";

describe("command heuristics", () => {
  test.each([
    ["bun test", true],
    ["npm run test -- --watch=false", true],
    ["cd pkg && pytest -q", true],
    ["cargo test --all", true],
    ["npx vitest run", true],
    ["python -m pytest", true],
    ["test -f package.json", false],
    ["cat tests/foo.ts", false],
    ["git status", false],
  ])("%s → tests=%p", (cmd, expected) => {
    expect(looksLikeTests(cmd)).toBe(expected);
  });

  test("command without parsed actions is typing", () => {
    const action = itemAction({
      type: "commandExecution",
      id: "i",
      pluginId: null,
      scriptPath: null,
      command: "git commit -m x",
      cwd: "/w",
      processId: null,
      source: "agent",
      status: "inProgress",
      commandActions: [],
      aggregatedOutput: null,
      exitCode: null,
      durationMs: null,
    });
    expect(action).toEqual({ action: "typing", detail: "git commit -m x" });
  });
});

describe("usage", () => {
  test("window kinds", () => {
    expect(windowKind(300)).toBe("five_hour");
    expect(windowKind(10_080)).toBe("seven_day");
    expect(windowKind(43_200)).toBe("monthly");
    expect(windowKind(15)).toBeNull();
    expect(windowKind(null)).toBeNull();
  });

  test("non-default buckets and sparse updates", () => {
    expect(
      limitSamples(
        {
          limitId: "codex_other",
          primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: null },
        },
        1,
      ),
    ).toEqual([]);
    expect(
      limitSamples({ primary: { usedPercent: 140, windowDurationMins: 300, resetsAt: null } }, 1),
    ).toEqual([{ windowKind: "five_hour", usedPct: 100, observedAt: 1, source: "inband" }]);
    expect(limitSamples(null, 1)).toEqual([]);
  });

  test("token tracker skips repeats", () => {
    const t = new TokenUsageTracker();
    const b = (total: number) => ({
      total: {
        totalTokens: total,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      last: {
        totalTokens: 10,
        inputTokens: 8,
        cachedInputTokens: 10,
        cacheWriteInputTokens: 1,
        outputTokens: 2,
        reasoningOutputTokens: 0,
      },
      modelContextWindow: null,
    });
    expect(t.next(b(10), 1)).toMatchObject({
      inputTokens: 0,
      cacheReadTokens: 10,
      cacheWriteTokens: 1,
      outputTokens: 2,
    });
    expect(t.next(b(10), 2)).toBeNull();
    expect(t.next(b(20), 3)).not.toBeNull();
  });
});

describe("approval responses", () => {
  const base = { threadId: "t", turnId: "u", itemId: "i", startedAtMs: 0 };
  const cmd = {
    method: "item/commandExecution/requestApproval",
    id: 1,
    params: { ...base, kind: "command", environmentId: null, command: "rm -rf build" },
  } as ApprovalRequest;
  const perms = {
    method: "item/permissions/requestApproval",
    id: 2,
    params: {
      ...base,
      environmentId: null,
      cwd: "/w",
      reason: null,
      permissions: { network: { enabled: true }, fileSystem: null },
    },
  } as ApprovalRequest;

  test("decisions", () => {
    expect(approvalResponse(cmd, "allow_once")).toEqual({ decision: "accept" });
    expect(approvalResponse(cmd, "allow_always")).toEqual({ decision: "acceptForSession" });
    expect(approvalResponse(cmd, "reject")).toEqual({ decision: "decline" });
    expect(approvalResponse(perms, "allow_always")).toEqual({
      permissions: { network: { enabled: true } },
      scope: "session",
    });
    expect(approvalResponse(perms, "reject")).toEqual({ permissions: {}, scope: "turn" });
  });

  test("network approval description", () => {
    const m = new CodexEventMapper();
    const req = {
      ...cmd,
      params: {
        ...cmd.params,
        networkApprovalContext: { host: "registry.npmjs.org", protocol: "https" },
      },
    } as ApprovalRequest;
    const e = m.permissionRequest("1", req, 5);
    expect(e.toolName).toBe("network");
    expect(e.description).toContain("registry.npmjs.org");
  });
});

test("mapper ignores other threads once the thread is known", () => {
  const m = new CodexEventMapper();
  m.threadId = "mine";
  const delta = (threadId: string) =>
    m.map(
      {
        method: "item/agentMessage/delta",
        params: { threadId, turnId: "u", itemId: "i", delta: "x" },
      },
      1,
    );
  expect(delta("other")).toEqual([]);
  expect(delta("mine")).toHaveLength(1);
});
