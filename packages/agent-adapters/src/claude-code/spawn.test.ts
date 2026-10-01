import { describe, expect, test } from "bun:test";
import { Secret } from "../secret.ts";
import { createFakeRunnerContext } from "../testing/fake-runner-context.ts";
import type { AgentRecord, PlannedFile, SpawnRequest } from "../types.ts";
import { ClaudeCodeAdapter } from "./adapter.ts";
import { settingsDir } from "./forwarders.ts";
import { credentialEnv } from "./spawn.ts";

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
      "--permission-mode",
      "auto",
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

  test("passes the henchman's permission mode; auto mode when none is set (#166)", () => {
    const modeOf = (argv: readonly string[]) => argv[argv.indexOf("--permission-mode") + 1];
    expect(modeOf(adapter.buildSpawn(request(), ctx).argv)).toBe("auto");
    for (const mode of ["auto", "default", "acceptEdits"]) {
      const argv = adapter.buildSpawn(request({ permissionMode: mode }), ctx).argv;
      expect(modeOf(argv)).toBe(mode);
      expect(argv.filter((a) => a === "--permission-mode")).toHaveLength(1);
    }
  });

  test("refuses a permission mode Claude Code is not offered in (#166)", () => {
    for (const mode of [
      "on-request",
      "never",
      "bypassPermissions",
      "plan",
      "--dangerously-skip-permissions",
      "",
    ]) {
      expect(() => adapter.buildSpawn(request({ permissionMode: mode }), ctx)).toThrow(
        /Invalid Claude permission mode/,
      );
    }
  });

  test("a resume keeps the henchman's permission mode (#166)", () => {
    const plan = adapter.buildSpawn(
      request({ resumeSessionId: "abc-123", permissionMode: "acceptEdits" }),
      ctx,
    );
    expect(plan.argv.join(" ")).toContain("--resume abc-123 --permission-mode acceptEdits");
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
    expect(plan.env.names()).toEqual(["DISABLE_AUTOUPDATER", "HOME"]);
  });

  test("the in-runner auto-updater is off for spawns, resumes and login terminals (#162)", () => {
    const record: AgentRecord = {
      agentId: "a1",
      ownerUserId: "u1",
      provider: "claude-code",
      profileId: "p1",
      status: "idle",
      workdir: "/w",
      tmuxSession: "agent-a1",
      providerSessionId: "abc-123",
    };
    const login = adapter.loginFlow(ctx);
    const plans = [
      adapter.buildSpawn(request(), ctx),
      adapter.buildAttachTui(record, ctx),
      login.kind === "pty_paste_code" ? login.plan : undefined,
    ];
    expect(plans.every(Boolean)).toBe(true);
    for (const plan of plans) expect(plan?.env.reveal().DISABLE_AUTOUPDATER).toBe("1");
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
