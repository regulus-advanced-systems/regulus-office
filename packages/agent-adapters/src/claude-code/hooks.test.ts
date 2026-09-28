import { describe, expect, test } from "bun:test";
import { AgentEvent } from "@regulus/protocol";
import fixtures from "./fixtures/hooks.json";
import { hookEventName, mapHookPayload, payloadSessionId, permissionSuggestions } from "./hooks.ts";

const TS = 1_700_000_000_000;
const map = (name: keyof typeof fixtures) =>
  mapHookPayload(fixtures[name], { now: TS, newRequestId: () => "perm-1" });

/** Compact view: status/action names and tool_call statuses. */
function shape(events: AgentEvent[]): string[] {
  return events.map((e) => {
    switch (e.kind) {
      case "status":
        return `status:${e.status}`;
      case "action":
        return `action:${e.action}`;
      case "tool_call":
        return `tool:${e.name}:${e.toolKind}:${e.status}`;
      case "permission_request":
        return `permission:${e.toolName}:${e.options.join("|")}`;
      default:
        return e.kind;
    }
  });
}

describe("mapHookPayload (documented payloads)", () => {
  const table: [keyof typeof fixtures, string[]][] = [
    ["SessionStart", ["status:idle", "action:none"]],
    ["UserPromptSubmit", ["status:working", "action:thinking"]],
    [
      "PreToolUse_Bash_test",
      ["status:working", "action:running_tests", "tool:Bash:execute:running"],
    ],
    ["PreToolUse_Bash_other", ["status:working", "action:typing", "tool:Bash:execute:running"]],
    ["PreToolUse_Read", ["status:working", "action:reading", "tool:Read:read:running"]],
    ["PreToolUse_Grep", ["status:working", "action:reading", "tool:Grep:search:running"]],
    ["PreToolUse_Edit", ["status:working", "action:editing", "tool:Edit:edit:running"]],
    ["PreToolUse_Write", ["status:working", "action:editing", "tool:Write:edit:running"]],
    ["PreToolUse_WebFetch", ["status:working", "action:browsing", "tool:WebFetch:fetch:running"]],
    [
      "PreToolUse_WebSearch",
      ["status:working", "action:browsing", "tool:WebSearch:search:running"],
    ],
    ["PreToolUse_Agent", ["status:working", "action:thinking", "tool:Agent:think:running"]],
    ["PreToolUse_AskUserQuestion", ["status:waiting_input", "tool:AskUserQuestion:other:running"]],
    ["PostToolUse", ["tool:Write:edit:completed"]],
    ["PostToolUseFailure", ["tool:Bash:execute:failed", "action:failing"]],
    [
      "PermissionRequest",
      ["status:waiting_permission", "permission:Bash:allow_once|allow_always|reject"],
    ],
    [
      "PermissionRequest_no_suggestions",
      ["status:waiting_permission", "permission:Edit:allow_once|reject"],
    ],
    ["Notification_permission_prompt", ["status:waiting_permission"]],
    ["Notification_idle_prompt", ["status:waiting_input"]],
    ["Notification_auth_success", []],
    ["Stop", ["status:done", "action:none"]],
    ["Stop_background", ["status:idle"]],
    ["StopFailure", ["status:error", "action:failing"]],
    ["SessionEnd", ["status:exited"]],
    ["SessionEnd_logout", ["status:offline"]],
  ];

  for (const [name, expected] of table) {
    test(`${name} → ${expected.join(", ") || "(nothing)"}`, () => {
      const events = map(name);
      expect(shape(events)).toEqual(expected);
      for (const event of events) expect(AgentEvent.safeParse(event).success).toBe(true);
    });
  }

  test("tool calls carry id, summary and locations", () => {
    const call = map("PreToolUse_Edit").find((e) => e.kind === "tool_call");
    expect(call).toMatchObject({
      callId: "toolu_01EDIT",
      summary: "/srv/office/projects/demo/src/index.ts",
      locations: ["/srv/office/projects/demo/src/index.ts"],
      ts: TS,
    });
  });

  test("permission request describes the tool call", () => {
    const req = map("PermissionRequest").find((e) => e.kind === "permission_request");
    expect(req).toMatchObject({
      requestId: "perm-1",
      toolName: "Bash",
      description: "Bash: rm -rf node_modules",
    });
  });

  test("failure detail is the first error line; interrupts do not animate failing", () => {
    const events = map("PostToolUseFailure");
    expect(events.find((e) => e.kind === "action")).toMatchObject({ detail: "Exit code 1" });
    const interrupted = mapHookPayload(
      { ...fixtures.PostToolUseFailure, is_interrupt: true },
      { now: TS, newRequestId: () => "x" },
    );
    expect(shape(interrupted)).toEqual(["tool:Bash:execute:failed"]);
  });

  test("unknown events and junk map to nothing", () => {
    const opts = { now: TS, newRequestId: () => "x" };
    expect(mapHookPayload({ hook_event_name: "FileChanged" }, opts)).toEqual([]);
    expect(mapHookPayload(null, opts)).toEqual([]);
    expect(mapHookPayload("PreToolUse", opts)).toEqual([]);
    expect(mapHookPayload({ hook_event_name: "PreToolUse", tool_name: 42 }, opts)).toEqual([]);
  });

  test("long inputs are clipped to protocol limits", () => {
    const events = mapHookPayload(
      {
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: { command: "x".repeat(10_000) },
      },
      { now: TS, newRequestId: () => "p" },
    );
    for (const event of events) expect(AgentEvent.safeParse(event).success).toBe(true);
  });

  test("helpers read event name, session id and suggestions", () => {
    expect(hookEventName(fixtures.Stop)).toBe("Stop");
    expect(payloadSessionId(fixtures.Stop)).toBe("00893aaf-19fa-41d2-8238-13269b9b3ca0");
    expect(permissionSuggestions(fixtures.PermissionRequest)).toHaveLength(1);
    expect(permissionSuggestions(fixtures.Stop)).toEqual([]);
  });
});
