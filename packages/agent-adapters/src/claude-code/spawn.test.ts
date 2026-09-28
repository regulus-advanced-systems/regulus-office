import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Secret } from "../secret.ts";
import { createFakeRunnerContext } from "../testing/fake-runner-context.ts";
import type { PlannedFile, SpawnRequest } from "../types.ts";
import { ClaudeCodeAdapter } from "./adapter.ts";
import { CLAUDE_HOOK_EVENTS } from "./hooks.ts";
import { credentialEnv, hookUrl, settingsDir, statuslineScript, statuslineUrl } from "./spawn.ts";

const TOKEN = "hook-token-DO-NOT-LEAK";
const API_KEY = "sk-ant-api-DO-NOT-LEAK";
const PLAN_KEY = "zai-plan-key-DO-NOT-LEAK";

const ctx = createFakeRunnerContext({ agentToken: Secret.of(TOKEN) });
const adapter = new ClaudeCodeAdapter({
  newSessionId: () => "11111111-2222-4333-8444-555555555555",
});

function request(overrides: Partial<SpawnRequest> = {}): SpawnRequest {
  return {
    agentId: "a1",
    provider: "claude-code",
    workdir: "/srv/office/projects/demo",
    credential: { kind: "cli_login" },
    ...overrides,
  };
}

const reveal = (file: PlannedFile) =>
  typeof file.contents === "string" ? file.contents : file.contents.reveal();

describe("buildSpawn", () => {
  test("runs claude with --settings and a fixed --session-id in agent-<id>", () => {
    const plan = adapter.buildSpawn(
      request({ model: "opus", effort: "high", prompt: "fix #3" }),
      ctx,
    );
    const dir = settingsDir(ctx.home, "a1");
    expect(plan.argv).toEqual([
      "claude",
      "--settings",
      `${dir}/settings.json`,
      "--session-id",
      "11111111-2222-4333-8444-555555555555",
      "--model",
      "opus",
      "--effort",
      "high",
      "fix #3",
    ]);
    expect(plan.tmuxSession).toBe("agent-a1");
    expect(plan.cwd).toBe("/srv/office/projects/demo");
    expect(plan.providerSessionId).toBe("11111111-2222-4333-8444-555555555555");
    expect(dir.startsWith(`${ctx.home}/.regulus-office/`)).toBe(true);
  });

  test("resumes with --resume <id>", () => {
    const plan = adapter.buildSpawn(request({ resumeSessionId: "abc-123" }), ctx);
    expect(plan.argv).toContain("--resume");
    expect(plan.argv).toContain("abc-123");
    expect(plan.argv).not.toContain("--session-id");
    expect(plan.providerSessionId).toBe("abc-123");
  });

  test("rejects argv-injection shaped ids, models and efforts", () => {
    expect(() => adapter.buildSpawn(request({ resumeSessionId: "--dangerously" }), ctx)).toThrow();
    expect(() => adapter.buildSpawn(request({ model: "-p" }), ctx)).toThrow();
    expect(() => adapter.buildSpawn(request({ effort: "extreme" }), ctx)).toThrow();
  });

  test("settings register an http hook per event with the bearer token", () => {
    const plan = adapter.buildSpawn(request(), ctx);
    const settingsFile = plan.files.find((f) => f.path.endsWith("/settings.json"));
    expect(settingsFile?.contents).toBeInstanceOf(Secret);
    expect(settingsFile?.mode).toBe(0o600);
    const settings = JSON.parse(reveal(settingsFile as PlannedFile));
    expect(Object.keys(settings.hooks).sort()).toEqual([...CLAUDE_HOOK_EVENTS].sort());
    for (const event of CLAUDE_HOOK_EVENTS) {
      const [group] = settings.hooks[event];
      expect(group.hooks).toEqual([
        {
          type: "http",
          url: hookUrl(ctx.officeUrl, "a1"),
          headers: { Authorization: `Bearer ${TOKEN}` },
          timeout: event === "PermissionRequest" ? adapter.permissionHoldSeconds + 5 : 10,
        },
      ]);
    }
    expect(settings.statusLine).toEqual({
      type: "command",
      command: `'${settingsDir(ctx.home, "a1")}/statusline.sh'`,
      padding: 0,
    });
    expect(hookUrl(ctx.officeUrl, "a1")).toBe("http://office.test/api/agents/a1/hooks/claude");
  });

  test("statusline script has no token; the headers file does and is 0600", () => {
    const plan = adapter.buildSpawn(request(), ctx);
    const script = plan.files.find((f) => f.path.endsWith("/statusline.sh")) as PlannedFile;
    const headers = plan.files.find((f) => f.path.endsWith("/statusline.headers")) as PlannedFile;
    expect(script.mode).toBe(0o700);
    expect(reveal(script)).not.toContain(TOKEN);
    expect(headers.contents).toBeInstanceOf(Secret);
    expect(headers.mode).toBe(0o600);
    expect(reveal(headers)).toBe(`Authorization: Bearer ${TOKEN}\n`);
  });

  test("without an agent token there are no hook files and no --settings", () => {
    const plan = adapter.buildSpawn(request(), createFakeRunnerContext());
    expect(plan.files).toEqual([]);
    expect(plan.argv).not.toContain("--settings");
  });

  test("never writes into ~/.claude", () => {
    const plan = adapter.buildSpawn(request(), ctx);
    for (const file of plan.files) expect(file.path).not.toContain("/.claude/");
  });
});

describe("credential env (SPEC §8)", () => {
  test("cli_login injects no Anthropic credential", () => {
    const plan = adapter.buildSpawn(request(), ctx);
    expect(plan.env.names()).toEqual(["HOME"]);
  });

  test("docker backend sets IS_SANDBOX", () => {
    const plan = adapter.buildSpawn(request(), { ...ctx, backend: "docker" });
    expect(plan.env.reveal().IS_SANDBOX).toBe("1");
  });

  test("api_key goes to ANTHROPIC_API_KEY in env only", () => {
    const plan = adapter.buildSpawn(
      request({
        credential: { kind: "api_key", apiKey: Secret.of(API_KEY), attributedTo: "user" },
      }),
      ctx,
    );
    expect(plan.env.reveal().ANTHROPIC_API_KEY).toBe(API_KEY);
    expect(plan.argv.join(" ")).not.toContain(API_KEY);
    for (const file of plan.files) expect(reveal(file)).not.toContain(API_KEY);
  });

  test("base_url_key: Z.AI uses ANTHROPIC_AUTH_TOKEN plus model overrides", () => {
    const env = credentialEnv({
      kind: "base_url_key",
      baseUrl: "https://api.z.ai/api/anthropic",
      apiKey: Secret.of(PLAN_KEY),
      modelOverrides: { opus: "glm-5", haiku: "glm-4.7-air" },
      attributedTo: "user",
    }).reveal();
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
      ANTHROPIC_AUTH_TOKEN: PLAN_KEY,
      API_TIMEOUT_MS: "3000000",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4.7-air",
    });
  });

  test("base_url_key: Kimi uses ANTHROPIC_API_KEY", () => {
    const env = credentialEnv({
      kind: "base_url_key",
      baseUrl: "https://api.kimi.ai/coding/",
      apiKey: Secret.of(PLAN_KEY),
      attributedTo: "office",
    });
    expect(env.names()).toContain("ANTHROPIC_API_KEY");
    expect(env.names()).not.toContain("ANTHROPIC_AUTH_TOKEN");
  });

  test("bad base URLs and override keys are refused", () => {
    const base = { kind: "base_url_key", apiKey: Secret.of("k"), attributedTo: "user" } as const;
    expect(() => credentialEnv({ ...base, baseUrl: "file:///etc/passwd" })).toThrow();
    expect(() => credentialEnv({ ...base, baseUrl: "not a url" })).toThrow();
    expect(() =>
      credentialEnv({ ...base, baseUrl: "https://x.test", modelOverrides: { PATH: "x" } }),
    ).toThrow();
  });

  test("serialising a plan never reveals keys or the hook token", () => {
    const plan = adapter.buildSpawn(
      request({
        credential: {
          kind: "base_url_key",
          baseUrl: "https://api.deepseek.com/anthropic",
          apiKey: Secret.of(PLAN_KEY),
          attributedTo: "user",
        },
      }),
      ctx,
    );
    const dumped = `${JSON.stringify(plan)} ${String(plan.env)} ${Bun.inspect(plan)}`;
    expect(dumped).not.toContain(PLAN_KEY);
    expect(dumped).not.toContain(TOKEN);
    expect(dumped).toContain("ANTHROPIC_AUTH_TOKEN");
  });
});

describe.skipIf(!Bun.which("curl"))("statusline forwarder script", () => {
  let dir: string;
  let received: { auth: string | null; body: unknown }[] = [];
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "rgo-statusline-"));
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        received.push({ auth: req.headers.get("authorization"), body: await req.json() });
        return new Response(null, { status: 204 });
      },
    });
  });

  afterAll(async () => {
    server.stop(true);
    await rm(dir, { recursive: true, force: true });
  });

  async function runScript(url: string): Promise<{ code: number; out: string; err: string }> {
    const script = join(dir, "statusline.sh");
    await writeFile(script, statuslineScript("a1", url), { mode: 0o700 });
    await writeFile(join(dir, "statusline.headers"), `Authorization: Bearer ${TOKEN}\n`, {
      mode: 0o600,
    });
    const proc = Bun.spawn(["sh", script], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    proc.stdin.write(JSON.stringify({ session_id: "s1", model: { display_name: "Opus" } }));
    await proc.stdin.end();
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, out, err };
  }

  test("POSTs the JSON with the bearer header and prints only a status line", async () => {
    received = [];
    const res = await runScript(statuslineUrl(`http://127.0.0.1:${server.port}`, "a1"));
    expect(res.code).toBe(0);
    expect(res.out).toBe("Regulus Office | Opus\n");
    expect(`${res.out}${res.err}`).not.toContain(TOKEN);
    expect(received).toEqual([
      { auth: `Bearer ${TOKEN}`, body: { session_id: "s1", model: { display_name: "Opus" } } },
    ]);
  });

  test("an unreachable office does not fail the statusline", async () => {
    const res = await runScript("http://127.0.0.1:1/api/agents/a1/statusline");
    expect(res.code).toBe(0);
    expect(res.out).toBe("Regulus Office | Opus\n");
    expect(`${res.out}${res.err}`).not.toContain(TOKEN);
  });
});
