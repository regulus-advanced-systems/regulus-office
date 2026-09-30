import { describe, expect, test } from "bun:test";
import { AgentEvent } from "@regulus/protocol";
import { Secret } from "../secret.ts";
import { createFakeRunnerContext, createFakeRunnerOps } from "../testing/fake-runner-context.ts";
import type { AgentRecord } from "../types.ts";
import { ClaudeCodeAdapter } from "./adapter.ts";
import hooks from "./fixtures/hooks.json";
import statusline from "./fixtures/statusline.json";
import { PermissionBroker, permissionHookResponse } from "./permissions.ts";
import { parseTranscriptUsage, transcriptRoot } from "./transcript.ts";

const transcript = await Bun.file(new URL("./fixtures/transcript.jsonl", import.meta.url)).text();

function setup() {
  const runner = createFakeRunnerOps();
  const ctx = createFakeRunnerContext({ runner, agentToken: Secret.of("tok") });
  const adapter = new ClaudeCodeAdapter({ newRequestId: () => "perm-1" });
  const plan = adapter.buildSpawn(
    { agentId: "a1", provider: "claude-code", workdir: "/w", credential: { kind: "cli_login" } },
    ctx,
  );
  return { runner, ctx, adapter, plan };
}

async function take<T>(it: AsyncIterable<T>, n: number): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) {
    out.push(v);
    if (out.length === n) break;
  }
  return out;
}

describe("ClaudeCodeAdapter", () => {
  test("id and capabilities", () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.id).toBe("claude-code");
    expect(adapter.capabilities).toMatchObject({ attachTui: true, resume: true, limits: true });
    expect(adapter.capabilities.deviceLogin).toBe(false);
  });

  test("login is /login in the human's own terminal; the plan carries no credential", () => {
    const { adapter, ctx } = setup();
    const login = adapter.loginFlow(ctx);
    expect(login.kind).toBe("pty_paste_code");
    if (login.kind !== "pty_paste_code") return;
    expect(login.instructions).toContain("/login");
    expect(login.plan.argv).toEqual(["claude"]);
    expect(login.plan.env.names()).toEqual(["DISABLE_AUTOUPDATER", "HOME"]);
    expect(login.plan.files).toEqual([]);
  });

  test("prompt types into the pane; attachments become @mentions; interrupt sends Escape", async () => {
    const { adapter, ctx, plan, runner } = setup();
    const control = adapter.connect(plan, ctx);
    await control.prompt("fix the\nbug", [
      { name: "a.png", mimeType: "image/png", path: "/w/a.png" },
    ]);
    await control.interrupt();
    expect(runner.keys).toEqual([
      { session: "agent-a1", keys: "fix the bug @/w/a.png", enter: true },
      { session: "agent-a1", keys: "\u001b", enter: false },
    ]);
  });

  test("respondPermission answers a held hook and reports working", async () => {
    const { adapter, ctx, plan } = setup();
    const control = adapter.connect(plan, ctx);
    const events = control.events[Symbol.asyncIterator]();
    expect((await events.next()).value).toMatchObject({ kind: "status", status: "starting" });
    const waiting = adapter.permissions.wait("a1", "perm-1", [], 5_000);
    await control.respondPermission("perm-1", "allow_once");
    expect(await waiting).toBe("allow_once");
    expect((await events.next()).value).toMatchObject({ kind: "status", status: "working" });
    await expect(control.respondPermission("perm-1", "reject")).rejects.toThrow(/terminal/);
  });

  test("close releases held hooks and ends events", async () => {
    const { adapter, ctx, plan } = setup();
    const control = adapter.connect(plan, ctx);
    const waiting = adapter.permissions.wait("a1", "perm-9", [], 5_000);
    await control.close();
    expect(await waiting).toBeNull();
    expect(await take(control.events, 5)).toHaveLength(1);
    await expect(control.prompt("x")).rejects.toThrow(/closed/);
  });

  test("session id follows hook payloads (e.g. after /clear)", () => {
    const { adapter, ctx, plan } = setup();
    const control = adapter.connect(plan, ctx);
    expect(control.providerSessionId()).toBe(plan.providerSessionId as string);
    adapter.ingest({ channel: "hook", agentId: "a1", payload: hooks.SessionStart }, ctx);
    expect(control.providerSessionId()).toBe(hooks.SessionStart.session_id);
  });

  test("buildAttachTui resumes the known session in the agent's tmux session", () => {
    const { adapter, ctx } = setup();
    const agent: AgentRecord = {
      agentId: "a1",
      ownerUserId: "u1",
      provider: "claude-code",
      profileId: "p",
      status: "idle",
      tmuxSession: "agent-a1",
      workdir: "/w",
      providerSessionId: "sess-1",
    };
    const plan = adapter.buildAttachTui(agent, ctx);
    expect(plan?.argv.slice(-4)).toEqual(["--resume", "sess-1", "--permission-mode", "auto"]);
    const manual = adapter.buildAttachTui({ ...agent, permissionMode: "default" }, ctx);
    expect(manual?.argv.slice(-2)).toEqual(["--permission-mode", "default"]);
    expect(plan?.argv).toContain("--settings");
    expect(plan?.tmuxSession).toBe("agent-a1");
    expect(
      adapter.buildAttachTui({ ...agent, agentId: "a2", providerSessionId: undefined }, ctx),
    ).toBeNull();
  });

  test("statusline ingest: limits every time, usage only when cost grows", () => {
    const { adapter, ctx } = setup();
    const input = { channel: "statusline" as const, agentId: "a1", payload: statusline };
    const first = adapter.ingest(input, ctx);
    for (const e of first) expect(AgentEvent.safeParse(e).success).toBe(true);
    expect(first.map((e) => e.kind)).toEqual(["usage", "limit", "limit"]);
    expect(first[0]).toMatchObject({
      inputTokens: 8500,
      outputTokens: 1200,
      cacheWriteTokens: 5000,
      cacheReadTokens: 2000,
      costUsdEstimate: 0.01234,
      source: "statusline",
    });
    expect(first[1]).toMatchObject({
      windowKind: "five_hour",
      usedPct: 23.5,
      resetsAt: 1738425600000,
    });
    expect(first[2]).toMatchObject({ windowKind: "seven_day", usedPct: 41.2 });
    // Same totals again (e.g. a permission-mode change): no new usage.
    expect(adapter.ingest(input, ctx).map((e) => e.kind)).toEqual(["limit", "limit"]);
    const grown = { ...statusline, cost: { ...statusline.cost, total_cost_usd: 0.02 } };
    const next = adapter.ingest({ ...input, payload: grown }, ctx);
    expect(next[0]).toMatchObject({ kind: "usage", costUsdEstimate: 0.00766 });
  });

  test("statusline without rate_limits (API key users) yields no limits", () => {
    const { adapter, ctx } = setup();
    const { rate_limits: _, ...noLimits } = statusline;
    const events = adapter.ingest({ channel: "statusline", agentId: "a1", payload: noLimits }, ctx);
    expect(events.map((e) => e.kind)).toEqual(["usage"]);
  });

  test("notify channel and junk are ignored", () => {
    const { adapter, ctx } = setup();
    expect(adapter.ingest({ channel: "notify", agentId: "a1", payload: {} }, ctx)).toEqual([]);
    expect(adapter.ingest({ channel: "statusline", agentId: "a1", payload: "x" }, ctx)).toEqual([]);
  });

  test("readUsage: latest limits plus deduped transcript usage, never touching credentials", async () => {
    const { adapter, ctx, runner } = setup();
    const root = transcriptRoot(ctx.home);
    runner.files.set(`${root}/-w/sess-1.jsonl`, transcript);
    runner.files.set(`${root}/-w/notes.txt`, "ignored");
    runner.files.set(`${ctx.home}/.claude/.credentials.json`, "SECRET-OAUTH");
    const read: string[] = [];
    const listed: string[] = [];
    const readTextFile = runner.readTextFile.bind(runner);
    const listDir = runner.listDir.bind(runner);
    runner.readTextFile = async (p) => {
      read.push(p);
      return readTextFile(p);
    };
    runner.listDir = async (p) => {
      listed.push(p);
      return listDir(p);
    };
    adapter.ingest({ channel: "statusline", agentId: "a1", payload: statusline }, ctx);
    const samples = [];
    for await (const s of adapter.readUsage(ctx)) samples.push(s);
    expect(samples.filter((s) => "windowKind" in s)).toHaveLength(2);
    const usage = samples.filter((s) => "inputTokens" in s);
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({
      inputTokens: 100,
      cacheReadTokens: 4000,
      source: "transcript",
    });
    expect(read).toEqual([`${root}/-w/sess-1.jsonl`]);
    expect(listed.every((p) => p.startsWith(root))).toBe(true);
  });

  test("transcript parsing honours since", () => {
    const since = Date.parse("2026-09-28T10:00:30.000Z");
    expect(parseTranscriptUsage(transcript, new Set(), since)).toHaveLength(1);
  });
});

describe("PermissionBroker", () => {
  test("reports each request's resolution: answered, expired, turn end", async () => {
    const broker = new PermissionBroker();
    const seen: string[] = [];
    const off = broker.onResolved("a", (id) => seen.push(id));
    broker.onResolved("b", () => seen.push("other agent"));
    const answered = broker.wait("a", "r1", [], 5_000);
    const held = broker.wait("a", "r2", [], 5_000);
    expect(broker.resolve("a", "r1", "allow_once")).toBe(true);
    expect(await answered).toBe("allow_once");
    expect(seen).toEqual(["r1"]);
    expect(await broker.wait("a", "r3", [], 5)).toBeNull();
    expect(seen).toEqual(["r1", "r3"]);
    broker.cancelAgent("a");
    expect(await held).toBeNull();
    expect(seen).toEqual(["r1", "r3", "r2"]);
    off();
    await broker.wait("a", "r4", [], 1);
    expect(seen).toHaveLength(3);
  });

  test("expires to null and honours abort", async () => {
    const broker = new PermissionBroker();
    expect(await broker.wait("a", "r", [], 10)).toBeNull();
    const ac = new AbortController();
    const waiting = broker.wait("a", "r2", [], 5_000, ac.signal);
    expect(broker.pending("a")).toEqual(["r2"]);
    ac.abort();
    expect(await waiting).toBeNull();
    expect(broker.pending("a")).toEqual([]);
    expect(broker.resolve("a", "r2", "allow_once")).toBe(false);
  });

  test("hook response bodies follow the documented decision shape", () => {
    const suggestion = {
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "rm -rf node_modules" }],
      behavior: "allow",
      destination: "localSettings",
    };
    expect(permissionHookResponse("allow_once", [suggestion])).toEqual({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
    expect(permissionHookResponse("allow_always", [suggestion])).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "allow",
          updatedPermissions: [{ ...suggestion, destination: "session" }],
        },
      },
    });
    expect(permissionHookResponse("reject")).toMatchObject({
      hookSpecificOutput: { decision: { behavior: "deny" } },
    });
  });
});
