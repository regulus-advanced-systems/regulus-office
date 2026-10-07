/** The words in a henchman's bubble: from structured events only, short, redacted (#256). */
import { describe, expect, test } from "bun:test";
import { CLAUDE_SIGN_IN_REASON, mapHookPayload } from "@regulus/agent-adapters";
import { AGENT_BUBBLE_MAX_TEXT, AgentBubble, type AgentEvent } from "@regulus/protocol";
import { activityOf, askOf, type BubbleInput, bubbleFor, fileOf, programOf } from "./activity.ts";
import { applyEvent, henchmanState, viewFromRow } from "./henchman.ts";

const call = (
  over: Partial<Extract<AgentEvent, { kind: "tool_call" }>>,
): Extract<AgentEvent, { kind: "tool_call" }> => ({
  kind: "tool_call",
  ts: 1,
  callId: "c1",
  name: "Read",
  toolKind: "read",
  status: "running",
  ...over,
});

const input = (over: Partial<BubbleInput>): BubbleInput => ({
  agentId: "a1",
  status: "working",
  activity: "",
  ask: "",
  announce: "",
  statusReason: "",
  ...over,
});

describe("activity text", () => {
  test("a tool call becomes a few words with the file's base name only", () => {
    const at = (o: Parameters<typeof call>[0]) => activityOf(call(o));
    expect(at({ locations: ["/home/ada/work/repo/src/auth.ts"] })).toBe("reading auth.ts");
    expect(at({ toolKind: "edit", name: "Edit", locations: ["src/ui/App.tsx"] })).toBe(
      "editing App.tsx",
    );
    expect(at({ toolKind: "delete", locations: ["old.txt"] })).toBe("deleting old.txt");
    expect(at({ toolKind: "search", name: "Grep", summary: "password=" })).toBe(
      "searching the code",
    );
    expect(at({ toolKind: "fetch", summary: "https://internal.example/x?token=abc" })).toBe(
      "browsing the web",
    );
    expect(at({ toolKind: "think" })).toBe("planning");
    expect(at({ toolKind: "other", name: "mcp__vault__read_secret" })).toBe("using a tool");
    expect(at({})).toBe("reading files");
  });

  test("a command shows its program, never its arguments", () => {
    const run = (summary: string) =>
      activityOf(call({ toolKind: "execute", name: "Bash", summary }));
    expect(run("git push https://ada:hunter2@github.com/o/r.git")).toBe("running git");
    expect(run("API_KEY=sk-live-1234567890 curl -H 'Authorization: Bearer abc' https://x")).toBe(
      "running curl",
    );
    expect(run("/usr/local/bin/node scripts/build.js --secret=abc")).toBe("running node");
    expect(run("bun test apps/server")).toBe("running tests");
    expect(run("cd /home/ada/private && ls")).toBe("running a command");
    expect(run("$(cat ~/.ssh/id_rsa)")).toBe("running a command");
    expect(programOf(undefined)).toBeUndefined();
    expect(programOf("sudo systemctl restart x")).toBe("systemctl");
  });

  test("names that do not read as a file or look like a token are left out or redacted", () => {
    expect(fileOf(call({ locations: ["/tmp/a b; rm -rf.txt"] }))).toBeUndefined();
    expect(fileOf(call({ locations: ["/srv/"] }))).toBe("srv");
    const token = "ghp_abcdefghijklmnopqrstuvwxyz0123";
    const text = activityOf(call({ locations: [`/tmp/${token}`] })) ?? "";
    expect(text).not.toContain(token);
    expect(text).toContain("[redacted]");
  });

  test("messages and actions give fixed words; their text is never used", () => {
    const secret = "the password is hunter2";
    expect(
      activityOf({ kind: "message", ts: 1, role: "assistant", text: secret, partial: true }),
    ).toBe("writing a reply");
    expect(
      activityOf({ kind: "message", ts: 1, role: "thought", text: secret, partial: true }),
    ).toBe("thinking");
    expect(
      activityOf({ kind: "message", ts: 1, role: "user", text: secret, partial: false }),
    ).toBeUndefined();
    expect(activityOf({ kind: "action", ts: 1, action: "failing", detail: secret })).toBe(
      "hit a snag",
    );
    expect(activityOf({ kind: "action", ts: 1, action: "typing", detail: secret })).toBeUndefined();
    expect(activityOf(call({ status: "completed" }))).toBeUndefined();
    expect(activityOf(call({ status: "failed" }))).toBe("hit a snag");
  });

  test("a permission request is worded from the tool's name only", () => {
    expect(askOf("Bash")).toBe("approve a command");
    expect(askOf("shell")).toBe("approve a command");
    expect(askOf("apply_patch")).toBe("approve an edit");
    expect(askOf("Write")).toBe("approve an edit");
    expect(askOf("network")).toBe("approve network access");
    expect(askOf("mcp__x__y")).toBe("approve a tool");
  });
});

describe("the bubble by status", () => {
  test("working says what it does; starting and unknown activity have defaults", () => {
    expect(bubbleFor(input({ activity: "reading auth.ts" }))).toEqual({
      kind: "doing",
      text: "reading auth.ts",
      targetKind: "none",
      targetId: "",
    });
    expect(bubbleFor(input({})).text).toBe("working");
    expect(bubbleFor(input({ status: "starting" })).text).toBe("starting up");
  });

  test("waiting for permission or input asks for its human and opens the request", () => {
    expect(bubbleFor(input({ status: "waiting_permission", ask: "approve a command" }))).toEqual({
      kind: "needs_you",
      text: "waiting for you: approve a command",
      targetKind: "permission",
      targetId: "a1",
    });
    expect(bubbleFor(input({ status: "waiting_permission" })).text).toBe(
      "waiting for you: approve a tool",
    );
    expect(bubbleFor(input({ status: "waiting_input" }))).toEqual({
      kind: "needs_you",
      text: "waiting for you: answer a question",
      targetKind: "terminal",
      targetId: "a1",
    });
    expect(
      bubbleFor(input({ status: "waiting_input", statusReason: CLAUDE_SIGN_IN_REASON })).text,
    ).toBe("waiting for you: finish signing in");
    expect(bubbleFor(input({ status: "error" })).kind).toBe("needs_you");
  });

  test("done has an answer ready; idle, exited and offline show nothing", () => {
    expect(bubbleFor(input({ status: "done" }))).toMatchObject({
      kind: "answer_ready",
      targetKind: "terminal",
    });
    expect(bubbleFor(input({ status: "done", announce: "opened PR #12" })).text).toBe(
      "opened PR #12",
    );
    expect(bubbleFor(input({ status: "idle", announce: "opened PR #12" })).kind).toBe(
      "answer_ready",
    );
    for (const status of ["idle", "exited", "offline"] as const) {
      expect(bubbleFor(input({ status })).kind).toBe("none");
    }
  });

  test("every bubble fits the protocol, whatever the activity", () => {
    const long = "x".repeat(300);
    for (const status of ["working", "waiting_permission", "done"] as const) {
      const bubble = bubbleFor(input({ status, activity: long, ask: long, announce: long }));
      expect(AgentBubble.safeParse(bubble).success).toBe(true);
      expect(bubble.text.length).toBeLessThanOrEqual(AGENT_BUBBLE_MAX_TEXT);
    }
  });
});

describe("Claude Code hooks to the bubble", () => {
  const row = {
    id: "a1",
    name: "Gasket",
    operationId: "f1",
    repoId: "r1",
    deskSeatId: "seat-1",
    ownerUserId: "u1",
    provider: "claude-code" as const,
    model: "opus",
    effort: null,
    status: "starting" as const,
    taskTitle: "t",
    taskSummary: null,
    issueNumber: null,
    prNumber: null,
    worktreeBranch: null,
    lastActivityAt: null,
  };
  const SECRET = "sk-ant-api03-verysecretvalue1234567890";

  test("a turn: thinking, reading, running, asking, done; no secret on the way", () => {
    const view = viewFromRow(row, "Ada");
    let n = 0;
    const seen: string[] = [];
    const hook = (payload: Record<string, unknown>) => {
      for (const event of mapHookPayload(payload, { now: ++n, newRequestId: () => `r${n}` })) {
        applyEvent(view, event, n);
      }
      const state = henchmanState(view);
      seen.push(`${state.bubble.kind}: ${state.bubble.text}`);
      return state;
    };
    expect(henchmanState(view).name).toBe("Gasket");
    expect(henchmanState(view).bubble.text).toBe("starting up");

    hook({ hook_event_name: "UserPromptSubmit", prompt: `use ${SECRET}` });
    hook({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_use_id: "t1",
      tool_input: { file_path: "/workspace/repo/.env" },
    });
    hook({
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_use_id: "t1",
      tool_input: { file_path: "/workspace/repo/.env" },
      tool_response: { content: `ANTHROPIC_API_KEY=${SECRET}` },
    });
    hook({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "t2",
      tool_input: { command: `ANTHROPIC_API_KEY=${SECRET} git commit -m "add ${SECRET}"` },
    });
    const asking = hook({
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: `curl -H "x-api-key: ${SECRET}" https://example.com` },
    });
    expect(asking.bubble).toEqual({
      kind: "needs_you",
      text: "waiting for you: approve a command",
      targetKind: "permission",
      targetId: "a1",
    });
    hook({ hook_event_name: "Stop" });

    expect(seen).toEqual([
      "doing: thinking",
      "doing: reading .env",
      "doing: reading .env",
      "doing: running git",
      "needs_you: waiting for you: approve a command",
      "answer_ready: finished: take a look",
    ]);
    expect(seen.join("\n")).not.toContain("sk-ant");
    expect(seen.join("\n")).not.toContain("/workspace");
  });

  test("a new turn forgets the last announcement and the answered request", () => {
    const view = viewFromRow({ ...row, status: "done" as const }, "Ada");
    view.announce = "opened PR #12";
    view.ask = "approve a command";
    expect(henchmanState(view).bubble.text).toBe("opened PR #12");
    applyEvent(view, { kind: "status", ts: 5, status: "working" }, 5);
    expect(henchmanState(view).bubble).toMatchObject({ kind: "doing", text: "thinking" });
    applyEvent(
      view,
      {
        kind: "tool_call",
        ts: 6,
        callId: "c1",
        name: "Edit",
        toolKind: "edit",
        status: "running",
        locations: ["src/auth.ts"],
      },
      6,
    );
    applyEvent(view, { kind: "status", ts: 6, status: "waiting_permission" }, 6);
    expect(henchmanState(view).bubble.text).toBe("waiting for you: approve a tool");
    // Approved: back at work on what it was doing, not "thinking" again.
    applyEvent(view, { kind: "status", ts: 7, status: "working" }, 7);
    expect(henchmanState(view).bubble.text).toBe("editing auth.ts");
    applyEvent(view, { kind: "status", ts: 7, status: "done" }, 7);
    expect(henchmanState(view).bubble.text).toBe("finished: take a look");
  });
});
