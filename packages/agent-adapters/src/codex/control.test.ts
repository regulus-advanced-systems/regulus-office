import { describe, expect, test } from "bun:test";
import { AgentEvent } from "@regulus/protocol";
import { createFakeRunnerContext, createFakeRunnerOps } from "../testing/fake-runner-context.ts";
import { CodexAdapter } from "./adapter.ts";
import type { CodexControl } from "./control.ts";
import {
  ask,
  CWD,
  fail,
  handshake,
  note,
  out,
  reply,
  TURN_ID,
  threadResponse,
  turn,
} from "./fixtures/builders.ts";
import {
  failuresAndServerRequests,
  resumeAndInterrupt,
  THREAD_ID,
  toJsonl,
  turnWithApprovals,
} from "./fixtures/documented.ts";
import { FakeAppServerProcess } from "./testing/fake-app-server.ts";
import type { TraceStep } from "./testing/trace.ts";

function setup(steps: TraceStep[], resumeSessionId?: string) {
  let proc: FakeAppServerProcess | undefined;
  const runner = createFakeRunnerOps(async () => {
    proc = new FakeAppServerProcess(toJsonl(steps));
    return proc;
  });
  const ctx = createFakeRunnerContext({ runner });
  const adapter = new CodexAdapter();
  const plan = adapter.buildSpawn(
    {
      agentId: "a1",
      provider: "codex",
      workdir: "/srv/office/worktrees/f1/a1",
      credential: { kind: "cli_login" },
      resumeSessionId,
    },
    ctx,
  );
  const control = adapter.connect(plan, ctx);
  const events: AgentEvent[] = [];
  const pump = (async () => {
    for await (const e of control.events) events.push(e);
  })();
  const server = () => proc as FakeAppServerProcess;
  return { control, events, pump, server, runner };
}

async function until(check: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(2);
  }
}

const kinds = (events: AgentEvent[]) => events.map((e) => e.kind);
const permission = (events: AgentEvent[], n: number) =>
  events.filter((e) => e.kind === "permission_request")[n];

describe("CodexControl against documented traces", () => {
  test("turn with command and file approvals, messages, usage, limits", async () => {
    const { control, events, pump, server } = setup(turnWithApprovals);
    await (control as CodexControl).ready();
    expect(control.providerSessionId()).toBe(THREAD_ID);
    await until(() => events.some((e) => e.kind === "limit"));
    await control.prompt("Run the tests and fix app.ts");

    await until(() => permission(events, 0) !== undefined);
    const first = permission(events, 0);
    expect(first).toMatchObject({
      toolName: "shell",
      options: ["allow_once", "allow_always", "reject"],
    });
    expect(first?.kind === "permission_request" && first.description).toContain("$ bun test");
    expect(events.at(-1)).toMatchObject({ kind: "status", status: "waiting_permission" });
    await control.respondPermission((first as { requestId: string }).requestId, "allow_once");

    await until(() => permission(events, 1) !== undefined);
    const second = permission(events, 1) as { requestId: string; description: string };
    expect(second).toMatchObject({ toolName: "apply_patch" });
    expect(second.description).toContain("src/app.ts");
    await control.respondPermission(second.requestId, "allow_always");

    await until(() => server().replayer.done);
    await until(() =>
      events.some((e) => e.kind === "status" && e.status === "idle" && events.indexOf(e) > 5),
    );
    await control.close();
    await pump;
    expect(server().replayer.errors).toEqual([]);

    for (const e of events) expect(AgentEvent.safeParse(e).success).toBe(true);
    const actions = events
      .filter((e) => e.kind === "action")
      .map((e) => (e.kind === "action" ? e.action : ""));
    expect(actions).toEqual(["thinking", "running_tests", "editing", "browsing", "typing", "none"]);
    const messages = events.filter((e) => e.kind === "message");
    expect(messages.map((m) => (m.kind === "message" ? [m.role, m.text, m.partial] : []))).toEqual([
      ["thought", "Checking tests", true],
      ["assistant", "Tests ", true],
      ["assistant", "pass.", true],
      ["assistant", "Tests pass.", false],
    ]);
    const usage = events.filter((e) => e.kind === "usage");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      inputTokens: 200,
      cacheReadTokens: 1000,
      outputTokens: 300,
      source: "inband",
    });
    const limits = events.filter((e) => e.kind === "limit");
    expect(limits.map((l) => (l.kind === "limit" ? [l.windowKind, l.usedPct] : []))).toEqual([
      ["five_hour", 25],
      ["seven_day", 60],
      ["five_hour", 31],
    ]);
    expect(limits[0]).toMatchObject({ resetsAt: 1_730_947_200_000 });
    const tools = events.filter((e) => e.kind === "tool_call");
    expect(tools.map((t) => (t.kind === "tool_call" ? [t.name, t.status] : []))).toEqual([
      ["shell", "running"],
      ["shell", "completed"],
      ["apply_patch", "running"],
      ["apply_patch", "completed"],
      ["web_search", "running"],
      ["web_search", "completed"],
    ]);
    expect(kinds(events)[0]).toBe("status");
    expect(events.at(-1)).toMatchObject({ kind: "exit", reason: "closed" });
    expect(server().signals).toEqual(["SIGTERM"]);
  });

  test("parallel approvals resolve one by one: answered here, or cleared by the server", async () => {
    const approval = (id: number, cmd: string) =>
      ask({
        method: "item/commandExecution/requestApproval",
        id,
        params: {
          kind: "command",
          threadId: THREAD_ID,
          turnId: TURN_ID,
          itemId: `item_${id}`,
          startedAtMs: 3,
          environmentId: null,
          reason: "Run it",
          command: cmd,
          cwd: CWD,
        },
      });
    const { control, events, pump, server } = setup([
      ...handshake(),
      out({ method: "thread/start", id: 1 }),
      reply("thread/start", 1, threadResponse),
      out({ method: "account/rateLimits/read", id: 2 }),
      fail(2, -32600, "not signed in"),
      out({ method: "turn/start", id: 3 }),
      reply("turn/start", 3, { turn: turn("inProgress") }),
      approval(7, "bun test"),
      approval(9, "bun run lint"),
      out({ id: 7, result: { decision: "accept" } }),
      note({ method: "serverRequest/resolved", params: { threadId: THREAD_ID, requestId: 7 } }),
      note({ method: "serverRequest/resolved", params: { threadId: THREAD_ID, requestId: 9 } }),
    ]);
    const resolved: string[] = [];
    const off = control.onPermissionResolved?.((id) => resolved.push(id));
    await (control as CodexControl).ready();
    await control.prompt("check");
    await until(() => permission(events, 1) !== undefined);
    expect((control as CodexControl).pendingPermissions()).toEqual(["7", "9"]);

    await control.respondPermission("7", "allow_once");
    expect(resolved).toEqual(["7"]);
    expect((control as CodexControl).pendingPermissions()).toEqual(["9"]);

    await until(() => server().replayer.done);
    await until(() => resolved.length === 2);
    expect(resolved).toEqual(["7", "9"]);
    expect((control as CodexControl).pendingPermissions()).toEqual([]);
    off?.();
    await control.close();
    await pump;
    expect(server().replayer.errors).toEqual([]);
  });

  test("resume, steer while running, interrupt", async () => {
    const { control, events, pump, server } = setup(resumeAndInterrupt, THREAD_ID);
    await (control as CodexControl).ready();
    expect(control.providerSessionId()).toBe(THREAD_ID);
    await control.prompt("look around");
    await until(() => events.some((e) => e.kind === "action"));
    expect(events.find((e) => e.kind === "action")).toMatchObject({ action: "reading" });
    await control.prompt("also check the docs");
    await control.interrupt();
    await until(() => server().replayer.done);
    await until(() => events.some((e) => e.kind === "status" && e.reason === "interrupted"));
    await control.interrupt(); // no active turn: no request
    await control.close();
    await control.close();
    await pump;
    expect(server().replayer.errors).toEqual([]);
    expect(events.some((e) => e.kind === "limit")).toBe(false);
  });

  test("errors, rejected permissions, unsupported server requests, crash", async () => {
    const { control, events, pump, server } = setup(failuresAndServerRequests);
    await (control as CodexControl).ready();
    await control.prompt("install deps");
    await until(() => permission(events, 0) !== undefined);
    const req = permission(events, 0) as {
      requestId: string;
      toolName: string;
      description: string;
    };
    expect(req.toolName).toBe("permissions");
    expect(req.description).toContain("Network access");
    await expect(control.respondPermission("nope", "reject")).rejects.toThrow("Unknown permission");
    await control.respondPermission(req.requestId, "reject");
    await pump;
    expect(server().replayer.errors).toEqual([]);
    const statuses = events
      .filter((e) => e.kind === "status")
      .map((e) => (e.kind === "status" ? e.status : ""));
    expect(statuses).toEqual(["starting", "idle", "waiting_permission", "working", "error"]);
    const failing = events.filter((e) => e.kind === "action" && e.action === "failing");
    expect(failing).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ kind: "exit", code: 1, reason: "app-server exited" });
    await expect(control.prompt("again")).rejects.toThrow();
  });

  test("spawn failure ends the stream with status error and exit", async () => {
    const runner = createFakeRunnerOps(async () => {
      throw new Error("no such user");
    });
    const ctx = createFakeRunnerContext({ runner });
    const adapter = new CodexAdapter();
    const plan = adapter.buildSpawn(
      { agentId: "a1", provider: "codex", workdir: "/w", credential: { kind: "cli_login" } },
      ctx,
    );
    const control = adapter.connect(plan, ctx);
    const events: AgentEvent[] = [];
    for await (const e of control.events) events.push(e);
    expect(kinds(events)).toEqual(["status", "status", "exit"]);
    expect(events[1]).toMatchObject({ status: "error", reason: "no such user" });
    await expect(control.prompt("x")).rejects.toThrow("closed");
  });
});
