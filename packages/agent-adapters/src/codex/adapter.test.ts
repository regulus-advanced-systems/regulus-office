import { describe, expect, test } from "bun:test";
import { AdapterRegistry } from "../registry.ts";
import { REDACTED, Secret } from "../secret.ts";
import { createFakeRunnerContext, createFakeRunnerOps } from "../testing/fake-runner-context.ts";
import type { AgentRecord, SpawnPlan } from "../types.ts";
import { CODEX_CAPABILITIES, CODEX_KEY_ENV, CodexAdapter } from "./adapter.ts";
import { FakeAppServerProcess, loadFixture } from "./testing/fake-app-server.ts";

const KEY = "sk-test-DO-NOT-LEAK";

function ctxWith(fixture?: string) {
  const procs: FakeAppServerProcess[] = [];
  const runner = createFakeRunnerOps(async () => {
    if (!fixture) throw new Error("no fixture");
    const proc = new FakeAppServerProcess(await loadFixture(fixture));
    procs.push(proc);
    return proc;
  });
  return { ctx: createFakeRunnerContext({ runner }), procs, runner };
}

describe("CodexAdapter.buildSpawn", () => {
  const { ctx } = ctxWith();
  const adapter = new CodexAdapter();

  test("subscription login: app-server with HOME only, no secrets", () => {
    const plan = adapter.buildSpawn(
      {
        agentId: "a1",
        provider: "codex",
        workdir: "/w",
        model: "gpt-6-sol",
        effort: "high",
        credential: { kind: "cli_login" },
      },
      ctx,
    );
    expect(plan.argv).toEqual([
      "codex",
      "app-server",
      "-c",
      'model="gpt-6-sol"',
      "-c",
      'model_reasoning_effort="high"',
    ]);
    expect(plan.env.names()).toEqual(["HOME"]);
    expect(plan.env.reveal().HOME).toBe(ctx.home);
    expect(plan.tmuxSession).toBe("agent-a1");
    expect(plan.cwd).toBe("/w");
    expect(plan.providerSessionId).toBeUndefined();
    expect(adapter.id).toBe("codex");
    expect(adapter.capabilities).toEqual(CODEX_CAPABILITIES);
    expect(new AdapterRegistry([adapter]).get("codex")).toBe(adapter);
  });

  test("API key goes into env only, via a custom provider env_key", () => {
    const plan = adapter.buildSpawn(
      {
        agentId: "a1",
        provider: "codex",
        workdir: "/w",
        credential: { kind: "api_key", apiKey: Secret.of(KEY), attributedTo: "user" },
      },
      ctx,
    );
    expect(plan.argv.join(" ")).not.toContain(KEY);
    expect(plan.argv).toContain('model_provider="office_key"');
    expect(plan.argv.join(" ")).toContain(`env_key = "${CODEX_KEY_ENV}"`);
    expect(plan.argv.join(" ")).toContain('base_url = "https://api.openai.com/v1"');
    expect(plan.env.reveal()[CODEX_KEY_ENV]).toBe(KEY);
    expect(JSON.stringify(plan)).not.toContain(KEY);
    expect(JSON.stringify(plan.env)).toContain(REDACTED);
    expect(Bun.inspect(plan)).not.toContain(KEY);
  });

  test("base URL key profile", () => {
    const plan = adapter.buildSpawn(
      {
        agentId: "a1",
        provider: "codex",
        workdir: "/w",
        credential: {
          kind: "base_url_key",
          baseUrl: "https://api.example.test/v1",
          apiKey: Secret.of(KEY),
          attributedTo: "office",
        },
      },
      ctx,
    );
    expect(plan.argv.join(" ")).toContain('base_url = "https://api.example.test/v1"');
    expect(plan.env.has(CODEX_KEY_ENV)).toBe(true);
  });

  test("rejects unsafe values and non-http base URLs", () => {
    const req = {
      agentId: "a1",
      provider: "codex" as const,
      workdir: "/w",
      credential: { kind: "cli_login" as const },
    };
    expect(() => adapter.buildSpawn({ ...req, model: 'x" \n[evil]' }, ctx)).toThrow("Unsafe");
    expect(() => adapter.buildSpawn({ ...req, resumeSessionId: "--help" }, ctx)).toThrow(
      "thread id",
    );
    expect(() =>
      adapter.buildSpawn(
        {
          ...req,
          credential: {
            kind: "base_url_key",
            baseUrl: "file:///etc/passwd",
            apiKey: Secret.of(KEY),
            attributedTo: "user",
          },
        },
        ctx,
      ),
    ).toThrow("http");
  });

  test("resume carries the thread id on the plan", () => {
    const plan = adapter.buildSpawn(
      {
        agentId: "a1",
        provider: "codex",
        workdir: "/w",
        resumeSessionId: "019a-thread",
        credential: { kind: "cli_login" },
      },
      ctx,
    );
    expect(plan.providerSessionId).toBe("019a-thread");
  });
});

describe("CodexAdapter.buildAttachTui", () => {
  const { ctx } = ctxWith();
  const adapter = new CodexAdapter();
  const agent: AgentRecord = {
    agentId: "a1",
    ownerUserId: "u1",
    provider: "codex",
    model: "gpt-6-sol",
    profileId: "p1",
    status: "idle",
    providerSessionId: "019a-thread",
    tmuxSession: "agent-a1",
    workdir: "/w",
  };

  test("codex resume <threadId> in the agent's tmux session", () => {
    const plan = adapter.buildAttachTui(agent, ctx) as SpawnPlan;
    expect(plan.argv).toEqual([
      "codex",
      "resume",
      "-c",
      'model="gpt-6-sol"',
      "-c",
      'approval_policy="on-request"',
      "019a-thread",
    ]);
    const never = adapter.buildAttachTui({ ...agent, permissionMode: "never" }, ctx) as SpawnPlan;
    expect(never.argv).toContain('approval_policy="never"');
    expect(plan.tmuxSession).toBe("agent-a1");
    expect(plan.cwd).toBe("/w");
  });

  test("null without a thread id or with an unsafe one", () => {
    expect(adapter.buildAttachTui({ ...agent, providerSessionId: undefined }, ctx)).toBeNull();
    expect(adapter.buildAttachTui({ ...agent, providerSessionId: "-x" }, ctx)).toBeNull();
  });
});

describe("recorded traces (real codex 0.158.0, logged out, scratch CODEX_HOME)", () => {
  test("device-code login: surfaces URL + code, cancel settles completion", async () => {
    const { ctx, procs, runner } = ctxWith("recorded/device-login-cancel.jsonl");
    const flow = new CodexAdapter().loginFlow(ctx);
    if (flow.kind !== "device_code") throw new Error("expected device_code");
    const login = await flow.begin();
    expect(login.verificationUrl).toBe("https://auth.openai.com/codex/device");
    expect(login.userCode).toBe("ABCD-1234");
    await login.cancel();
    expect(await login.completion).toEqual({ ok: false, reason: "cancelled" });
    const proc = procs[0] as FakeAppServerProcess;
    expect(proc.replayer.errors).toEqual([]);
    expect(proc.replayer.done).toBe(true);
    expect(proc.signals).toContain("SIGTERM");
    const plan = (runner as ReturnType<typeof createFakeRunnerOps>).piped[0] as SpawnPlan;
    expect(plan.argv).toEqual(["codex", "app-server"]);
    expect(plan.env.names()).toEqual(["HOME"]);
  });

  test("device-code login completes when codex reports success", async () => {
    const trace = (await loadFixture("recorded/device-login-cancel.jsonl"))
      .split("\n")
      .filter((l) => l && !l.includes("account/login/cancel") && !l.includes('"status":"canceled"'))
      .map((l) =>
        l.replace(
          '"success":false,"error":"Login was not completed"',
          '"success":true,"error":null',
        ),
      )
      .join("\n");
    const runner = createFakeRunnerOps(async () => new FakeAppServerProcess(trace));
    const ctx = createFakeRunnerContext({ runner });
    const flow = new CodexAdapter().loginFlow(ctx);
    if (flow.kind !== "device_code") throw new Error("expected device_code");
    const login = await flow.begin();
    expect(await login.completion).toEqual({ ok: true });
  });

  test("readUsage while logged out yields nothing and closes the server", async () => {
    const { ctx, procs } = ctxWith("recorded/usage-logged-out.jsonl");
    const samples = [];
    for await (const s of new CodexAdapter().readUsage(ctx)) samples.push(s);
    expect(samples).toEqual([]);
    expect(procs[0]?.replayer.errors).toEqual([]);
    expect(procs[0]?.replayer.done).toBe(true);
    expect(procs[0]?.signals).toEqual(["SIGTERM"]);
  });
});
