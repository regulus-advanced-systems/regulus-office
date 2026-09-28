import { describe, expect, test } from "bun:test";
import {
  checkAgentId,
  checkRunnerPath,
  checkSessionName,
  isAgentScope,
  RUNNER_ID,
  runnerId,
  runnerUserName,
} from "./ids.ts";

describe("runnerId", () => {
  test("short lowercase ids are used as they are", () => {
    expect(runnerId("u1")).toBe("u1");
    expect(runnerUserName("u1")).toBe("office-u-u1");
  });

  test("UUIDs hash to 23 hex chars and fit a 32-char Linux user name", () => {
    const id = runnerId("0b7e8f3c-1d2a-4c55-9f00-6e2b1a3c4d5e");
    expect(id).toMatch(/^[0-9a-f]{23}$/);
    expect(id).toBe(runnerId("0b7e8f3c-1d2a-4c55-9f00-6e2b1a3c4d5e"));
    expect(runnerUserName("0b7e8f3c-1d2a-4c55-9f00-6e2b1a3c4d5e").length).toBeLessThanOrEqual(32);
  });

  test("anything that is not a short lowercase id is hashed, so it always matches the helper", () => {
    for (const userId of ["U1", "a;rm -rf /", "../etc", "x".repeat(17), "ü", "a b"]) {
      expect(runnerId(userId)).toMatch(RUNNER_ID);
      expect(runnerId(userId)).toHaveLength(23);
    }
    expect(() => runnerId("")).toThrow();
  });
});

describe("argument checks", () => {
  test("agent ids and session names", () => {
    expect(checkAgentId("a1_b-2")).toBe("a1_b-2");
    for (const bad of ["", "a.b", "a:b", "a b", "a;b", "x".repeat(65)]) {
      expect(() => checkAgentId(bad)).toThrow();
    }
    expect(checkSessionName("agent-a1")).toBe("agent-a1");
    for (const bad of ["a1", "agent-", "agent-a.b", "=agent-a1", "agent-a1:0"]) {
      expect(() => checkSessionName(bad)).toThrow();
    }
  });

  test("runner paths are absolute and free of control characters", () => {
    expect(checkRunnerPath("/home/office-u-u1/.claude/x.json")).toBeTruthy();
    for (const bad of ["relative", "", "/a\nb", "/a\0b", `/${"x".repeat(4096)}`]) {
      expect(() => checkRunnerPath(bad)).toThrow();
    }
  });

  test("agent scopes never match another agent's", () => {
    expect(isAgentScope("agent-a1.scope", "a1")).toBe(true);
    expect(isAgentScope("agent-a1.io-0badf00d.scope", "a1")).toBe(true);
    expect(isAgentScope("agent-a10.scope", "a1")).toBe(false);
    expect(isAgentScope("agent-a1-x.scope", "a1")).toBe(false);
    expect(isAgentScope("office-tmux-u1.scope", "a1")).toBe(false);
  });
});
