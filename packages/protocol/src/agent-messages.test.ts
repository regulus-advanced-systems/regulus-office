import { describe, expect, test } from "bun:test";
import { mayControlRobot } from "./acl.ts";
import {
  AgentCommandResult,
  AgentLeaving,
  AgentPermissions,
  PendingPermission,
} from "./agent-messages.ts";
import { CommandRejected } from "./rooms.ts";

const request = {
  requestId: "p1",
  toolName: "Bash",
  description: "Bash: rm -rf build",
  options: ["allow_once", "allow_always", "reject"],
  requestedAt: 1,
  expiresAt: 120_001,
};

describe("agent messages", () => {
  test("permission requests carry what is being approved and the options", () => {
    expect(PendingPermission.parse(request)).toEqual(request as never);
    expect(PendingPermission.safeParse({ ...request, options: [] }).success).toBe(false);
    expect(PendingPermission.safeParse({ ...request, options: ["maybe"] }).success).toBe(false);
    expect(AgentPermissions.safeParse({ agentId: "a1", requests: [] }).success).toBe(true);
  });

  test("results are discriminated on the command type", () => {
    const pr = {
      type: "agent.pr",
      agentId: "a1",
      pr: {
        number: 3,
        url: "https://github.com/o/r/pull/3",
        draft: true,
        created: true,
        branch: "office/x",
      },
    };
    expect(AgentCommandResult.safeParse(pr).success).toBe(true);
    expect(AgentCommandResult.safeParse({ ...pr, pr: { ...pr.pr, url: "nope" } }).success).toBe(
      false,
    );
    expect(
      AgentCommandResult.safeParse({
        type: "agent.worktree",
        agentId: "a1",
        worktree: { branch: "office/x", uncommitted: ["a.ts"] },
      }).success,
    ).toBe(true);
    expect(AgentCommandResult.safeParse({ type: "agent.stop", agentId: "a1" }).success).toBe(true);
    expect(AgentCommandResult.safeParse({ type: "agent.spawn", agentId: "a1" }).success).toBe(
      false,
    );
    expect(AgentLeaving.safeParse({ agentId: "a1", reason: "sent_home" }).success).toBe(true);
  });

  test("rejections may name the robot and list uncommitted files", () => {
    expect(
      CommandRejected.safeParse({
        type: "agent.pr",
        reason: "uncommitted changes",
        agentId: "a1",
        files: ["src/a.ts"],
      }).success,
    ).toBe(true);
  });
});

describe("mayControlRobot (D12)", () => {
  test.each([
    ["owner", "someone", true],
    ["admin", "someone", true],
    ["member", "u1", true],
    ["member", "someone", false],
    ["viewer", "u1", false],
  ] as const)("%s controlling a robot owned by %s → %p", (role, owner, expected) => {
    expect(mayControlRobot({ id: "u1", role }, owner)).toBe(expected);
  });

  test("nobody signed in, or no owner, controls nothing", () => {
    expect(mayControlRobot(null, "u1")).toBe(false);
    expect(mayControlRobot({ id: "u1", role: "member" }, undefined)).toBe(false);
    expect(mayControlRobot({ id: "", role: "member" }, "")).toBe(false);
  });
});
