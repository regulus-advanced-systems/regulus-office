import { describe, expect, test } from "bun:test";
import { AgentEvent } from "@regulus/protocol";
import { Secret } from "../secret.ts";
import type { AgentRecord, SpawnRequest } from "../types.ts";
import { FakeAdapter } from "./fake-adapter.ts";
import { createFakeRunnerContext, createFakeRunnerOps } from "./fake-runner-context.ts";

const KEY = "sk-fake-DO-NOT-LEAK-9876";
const TOKEN = "hook-token-DO-NOT-LEAK";

function request(overrides: Partial<SpawnRequest> = {}): SpawnRequest {
  return {
    agentId: "a1",
    provider: "custom",
    workdir: "/srv/office/projects/demo",
    credential: { kind: "api_key", apiKey: Secret.of(KEY), attributedTo: "user" },
    ...overrides,
  };
}

describe("FakeAdapter.buildSpawn", () => {
  test("puts keys in the redacting env, never in argv or logs", () => {
    const adapter = new FakeAdapter({ command: ["fake-agent"] });
    const ctx = createFakeRunnerContext({ agentToken: Secret.of(TOKEN) });
    const plan = adapter.buildSpawn(request({ model: "m1", resumeSessionId: "s9" }), ctx);

    expect(plan.tmuxSession).toBe("agent-a1");
    expect(plan.argv).toEqual(["fake-agent", "--model", "m1", "--resume", "s9"]);
    expect(plan.providerSessionId).toBe("s9");
    expect(plan.env.reveal().FAKE_API_KEY).toBe(KEY);
    expect(plan.files[0]?.mode).toBe(0o600);

    for (const rendering of [JSON.stringify(plan), Bun.inspect(plan), String(plan.env)]) {
      expect(rendering).not.toContain(KEY);
      expect(rendering).not.toContain(TOKEN);
    }
    expect(adapter.spawns).toHaveLength(1);
  });

  test("maps base-URL profiles and CLI logins", () => {
    const adapter = new FakeAdapter();
    const ctx = createFakeRunnerContext();
    const baseUrl = adapter.buildSpawn(
      request({
        credential: {
          kind: "base_url_key",
          baseUrl: "https://api.example.test",
          apiKey: Secret.of(KEY),
          attributedTo: "office",
        },
      }),
      ctx,
    );
    expect(baseUrl.env.names()).toEqual(["FAKE_API_KEY", "FAKE_BASE_URL", "HOME"]);
    const cli = adapter.buildSpawn(request({ credential: { kind: "cli_login" } }), ctx);
    expect(cli.env.names()).toEqual(["HOME"]);
    expect(cli.files).toEqual([]);
  });
});

describe("FakeAdapter.connect", () => {
  test("replays the script, answers prompts and records calls", async () => {
    const adapter = new FakeAdapter({
      script: [
        { kind: "status", ts: 1, status: "idle" },
        {
          kind: "permission_request",
          ts: 2,
          requestId: "p1",
          toolName: "Bash",
          description: "bun test",
          options: ["allow_once", "reject"],
        },
      ],
      onPrompt: (text, ts) => [
        { kind: "message", ts, role: "assistant", text: `echo ${text}`, partial: false },
      ],
      providerSessionId: "thread-1",
    });
    const ctx = createFakeRunnerContext();
    const control = adapter.connect(adapter.buildSpawn(request(), ctx), ctx);
    expect(adapter.lastControl).toBe(control);
    expect(control.providerSessionId()).toBe("thread-1");

    await control.prompt("hi", [{ name: "a.png", mimeType: "image/png", path: "/tmp/a.png" }]);
    await expect(control.respondPermission("nope", "allow_once")).rejects.toThrow(/Unknown/);
    await control.respondPermission("p1", "allow_once");
    await control.interrupt();
    await control.close();
    await control.close();
    await expect(control.prompt("late")).rejects.toThrow(/closed/);

    const events: AgentEvent[] = [];
    for await (const event of control.events) events.push(AgentEvent.parse(event));
    expect(events.map((e) => e.kind)).toEqual([
      "status",
      "permission_request",
      "message",
      "status",
      "status",
      "exit",
    ]);
    expect(control.prompts).toEqual([
      { text: "hi", attachments: [{ name: "a.png", mimeType: "image/png", path: "/tmp/a.png" }] },
    ]);
    expect(control.permissionResponses).toEqual([{ id: "p1", decision: "allow_once" }]);
    expect(control.pendingPermissions()).toEqual([]);
    expect(control.interrupts).toBe(1);
  });
});

describe("FakeAdapter misc", () => {
  const ctx = createFakeRunnerContext();
  const agent: AgentRecord = {
    agentId: "a1",
    ownerUserId: "u1",
    provider: "custom",
    profileId: "office:custom",
    status: "idle",
    providerSessionId: "s1",
    tmuxSession: "agent-a1",
    workdir: "/w",
  };

  test("attach TUI follows the capability flag", () => {
    expect(new FakeAdapter().buildAttachTui(agent, ctx)?.argv).toEqual(["sh", "--resume", "s1"]);
    expect(
      new FakeAdapter({ capabilities: { attachTui: false } }).buildAttachTui(agent, ctx),
    ).toBeNull();
  });

  test("login flow defaults to api_key and can be scripted", async () => {
    expect(new FakeAdapter().loginFlow(ctx).kind).toBe("api_key");
    const adapter = new FakeAdapter({
      login: {
        kind: "device_code",
        begin: async () => ({
          verificationUrl: "https://example.test/device",
          userCode: "ABCD-1234",
          completion: Promise.resolve({ ok: true }),
          cancel: async () => {},
        }),
      },
    });
    const flow = adapter.loginFlow(ctx);
    if (flow.kind !== "device_code") throw new Error("expected device_code");
    const login = await flow.begin();
    expect(login.userCode).toBe("ABCD-1234");
    expect(await login.completion).toEqual({ ok: true });
  });

  test("readUsage filters by since", async () => {
    const adapter = new FakeAdapter({
      usage: [
        {
          ts: 10,
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          source: "inband",
        },
        { windowKind: "five_hour", usedPct: 40, observedAt: 20, source: "statusline" },
      ],
    });
    const all = [];
    for await (const sample of adapter.readUsage(ctx, { since: 15 })) all.push(sample);
    expect(all).toEqual([
      { windowKind: "five_hour", usedPct: 40, observedAt: 20, source: "statusline" },
    ]);
  });

  test("ingest keeps valid events and drops junk", () => {
    const adapter = new FakeAdapter();
    const good = { kind: "status", ts: 5, status: "waiting_input" };
    expect(adapter.ingest({ channel: "hook", agentId: "a1", payload: good })).toEqual([
      good as AgentEvent,
    ]);
    expect(
      adapter.ingest({ channel: "statusline", agentId: "a1", payload: { junk: true } }),
    ).toEqual([]);
    expect(adapter.ingested).toHaveLength(2);
  });
});

describe("createFakeRunnerOps", () => {
  test("records keys and serves panes and files", async () => {
    const ops = createFakeRunnerOps();
    await ops.sendKeys("agent-a1", "hello", { enter: true });
    ops.panes.set("agent-a1", "one\ntwo\nthree");
    ops.titles.set("agent-a1", "working");
    ops.files.set("/h/.claude/projects/x/s.jsonl", "{}");
    expect(ops.keys).toEqual([{ session: "agent-a1", keys: "hello", enter: true }]);
    expect(await ops.capturePane("agent-a1", 2)).toBe("two\nthree");
    expect(await ops.paneTitle("agent-a1")).toBe("working");
    expect(await ops.listDir("/h/.claude/projects")).toEqual(["x"]);
    expect(await ops.readTextFile("/missing")).toBeNull();
    await expect(ops.spawnPiped({} as never)).rejects.toThrow(/not scripted/);
  });
});
