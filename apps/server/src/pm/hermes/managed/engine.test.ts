/**
 * The `hermes-managed` engine (#57) with the fake Hermes gateway started as a
 * real process: start and the wait for `/health`, what Hermes is configured
 * with, a conversation, a crash and the restart, a gateway that hangs, one
 * that never starts, stop, and that no key reaches an event or a log line.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Secret } from "@regulus/agent-adapters";
import { captureLogger } from "../../../notifications/testing.ts";
import {
  EMPTY_MIND,
  type EngineAgent,
  type EngineEvent,
  type EngineOffice,
  EngineRefusal,
} from "../../engines/types.ts";
import type { HermesKeyKind } from "./config.ts";
import { HermesManagedEngine, type HermesManagedOptions } from "./engine.ts";
import { ProcessHermesHost } from "./testing/process-host.ts";

// Real processes are started and killed here.
setDefaultTimeout(30_000);

const MODEL_KEY = "sk-ant-api03-MODEL-KEY-do-not-leak-7f3a9c";
const OFFICE_TOKEN = "roa_OFFICE-TOKEN-do-not-leak-51be20";

const OFFICE: EngineOffice = {
  mcpUrl: "http://office.test/mcp",
  toolsUrl: "http://office.test/api/agent-tools",
  token: Secret.of(OFFICE_TOKEN),
  mind: { ...EMPTY_MIND, soul: () => "Keep answers short." },
};

const agentOf = (over: Partial<EngineAgent> = {}): EngineAgent => ({
  id: "agent-1",
  name: "Number Two",
  role: "pm",
  preset: "coordinator",
  ownerUserId: "mia",
  ownerName: "Mia",
  provider: "claude-code",
  model: "sonnet",
  effort: null,
  profileId: "p-anthropic",
  instructions: "",
  state: {},
  ...over,
});

const message = (text: string, id = "m1") => ({ id, userId: "mia", fromName: "Mia", text });

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup(
  options: { keyKind?: HermesKeyKind; engine?: Partial<HermesManagedOptions> } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "57-hermes-managed-"));
  const host = new ProcessHermesHost({ root });
  const log = captureLogger();
  const engine = new HermesManagedEngine({
    host,
    credentials: {
      resolve: (agent) => ({
        credential:
          options.keyKind === "deepseek"
            ? {
                kind: "base_url_key",
                baseUrl: "https://api.deepseek.com/anthropic",
                apiKey: Secret.of(MODEL_KEY),
                attributedTo: agent.ownerUserId === null ? "office" : "user",
              }
            : {
                kind: "api_key",
                apiKey: Secret.of(MODEL_KEY),
                attributedTo: agent.ownerUserId === null ? "office" : "user",
              },
        attributedTo: agent.ownerUserId === null ? "office" : { userId: agent.ownerUserId },
      }),
    },
    keyKind: (agent) => (agent.profileId ? (options.keyKind ?? "anthropic") : "login"),
    logger: log.logger,
    healthIntervalMs: 25,
    backoffBaseMs: 10,
    backoffMaxMs: 40,
    sendAttempts: 3,
    startTimeoutMs: 8000,
    startPollMs: 20,
    client: { requestTimeoutMs: 400, streamIdleMs: 400 },
    ...options.engine,
  });
  const events: EngineEvent[] = [];
  engine.onEvent((event) => events.push(event));
  cleanups.push(async () => {
    await engine.stop("agent-1");
    await host.reap();
    await rm(root, { recursive: true, force: true });
  });
  const of = <T extends EngineEvent["type"]>(type: T) =>
    events.filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type);
  const started = () =>
    JSON.parse(readFileSync(join(host.home("agent-1"), "fake-start.json"), "utf8")) as {
      pid: number;
      env: Record<string, string>;
      config: string | null;
    };
  /** Everything that leaves the engine: events and log lines. */
  const said = () => JSON.stringify(events) + log.text();
  return { root, host, engine, events, of, log, started, said };
}

/** What the fake gateway keeps in its home, once it holds `needle` (it saves a moment after a turn). */
async function kept(path: string, needle: string): Promise<string> {
  const read = () => (existsSync(path) ? readFileSync(path, "utf8") : "");
  await until(() => read().includes(needle));
  return read();
}

async function until(condition: () => boolean, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await Bun.sleep(10);
  }
}

const refusal = async (run: Promise<unknown>) => {
  const err = await run.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(EngineRefusal);
  return err as EngineRefusal;
};

describe("starting a Hermes of the office's own", () => {
  test("start launches the gateway, waits for /health, and configures key, model and office tools", async () => {
    const { engine, host, of, started, said } = await setup();
    await engine.start(agentOf(), OFFICE);
    expect(of("status").at(-1)).toMatchObject({ status: "ready" });
    expect(await engine.health("agent-1")).toEqual({
      ok: true,
      detail: "connected to Hermes 0.21.5",
    });
    expect(host.running("agent-1")).toBe(true);

    const { env, config } = started();
    // The office made up the gateway's key: long, random, and new for every start.
    expect(env.API_SERVER_ENABLED).toBe("true");
    expect(env.API_SERVER_KEY).toMatch(/^[0-9a-f]{64}$/);
    // An Anthropic key: Hermes's `anthropic` provider, with the API's model id for the alias.
    expect(env.ANTHROPIC_API_KEY).toBe(MODEL_KEY);
    expect(env.DEEPSEEK_API_KEY).toBeUndefined();
    expect(config).toContain('provider: "anthropic"');
    expect(config).toContain('default: "claude-sonnet-5-5"');
    // The office's tools, with the agent's own token: named in the file, held only in the environment.
    expect(config).toContain('url: "http://office.test/mcp"');
    expect(config).toContain("Bearer ${OFFICE_AGENT_TOKEN}");
    expect(env.OFFICE_AGENT_TOKEN).toBe(OFFICE_TOKEN);
    expect(config).not.toContain(OFFICE_TOKEN);
    expect(config).not.toContain(MODEL_KEY);
    // Nothing of the office's own environment reaches the gateway.
    expect(Object.keys(env).sort()).toEqual([
      "ANTHROPIC_API_KEY",
      "API_SERVER_ENABLED",
      "API_SERVER_HOST",
      "API_SERVER_KEY",
      "API_SERVER_PORT",
      "HERMES_HOME",
      "OFFICE_AGENT_TOKEN",
      "PATH",
    ]);
    for (const secret of [MODEL_KEY, OFFICE_TOKEN, env.API_SERVER_KEY ?? "?"]) {
      expect(said()).not.toContain(secret);
    }
  });

  test("a DeepSeek key becomes Hermes's own deepseek provider, with the model as picked", async () => {
    const { engine, started } = await setup({ keyKind: "deepseek" });
    await engine.start(agentOf({ model: "deepseek-flash", profileId: "p-ds" }), OFFICE);
    const { env, config } = started();
    expect(env.DEEPSEEK_API_KEY).toBe(MODEL_KEY);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(config).toContain('provider: "deepseek"');
    expect(config).toContain('default: "deepseek-flash"');
    // The Anthropic-compatible address the office keeps for Claude Code is not used for Hermes.
    expect(config).not.toContain("api.deepseek.com");
  });

  test("a subscription login and a key Hermes has no mapping for are refused before anything starts", async () => {
    const login = await setup();
    const noKey = await refusal(login.engine.start(agentOf({ profileId: null }), OFFICE));
    expect(noKey.code).toBe("hermes_key_required");
    expect(noKey.message).toContain("subscription login cannot be used");
    expect(() => login.engine.check(agentOf({ profileId: null }))).toThrow(EngineRefusal);
    expect(login.host.launches).toHaveLength(0);

    const kimi = await setup({ keyKind: "kimi" });
    const unsupported = await refusal(kimi.engine.start(agentOf(), OFFICE));
    expect(unsupported.code).toBe("hermes_key_unsupported");
    expect(kimi.host.launches).toHaveLength(0);
  });

  test("an office without the Hermes image says what the operator has to do", async () => {
    const { engine, host } = await setup();
    host.unavailable = "the Hermes image x is not on the Docker host: build or pull it";
    const err = await refusal(engine.start(agentOf(), OFFICE));
    expect(err.code).toBe("hermes_unavailable");
    expect(err.message).toContain("build or pull it");
    expect(await engine.health("agent-1")).toEqual({ ok: false, detail: "not started" });
  });

  test("a gateway that ends at once refuses the start with its reason, the key cut out", async () => {
    const { engine, host, started, said } = await setup();
    host.extraEnv = { FAKE_HERMES_EXIT: "3" };
    const err = await refusal(engine.start(agentOf(), OFFICE));
    expect(err.code).toBe("hermes_did_not_start");
    expect(err.message).toContain("exit code 3");
    expect(err.message).toContain("told to exit, key was [hidden]");
    const key = started().env.API_SERVER_KEY ?? "?";
    expect(err.message).not.toContain(key);
    expect(said()).not.toContain(key);
    expect(host.running("agent-1")).toBe(false);
  });

  test("a gateway that never answers is given up on and stopped", async () => {
    const { engine, host } = await setup({ engine: { startTimeoutMs: 300 } });
    host.extraEnv = { FAKE_HERMES_DEAF: "1" };
    const err = await refusal(engine.start(agentOf(), OFFICE));
    expect(err.code).toBe("hermes_did_not_start");
    expect(err.message).toContain("did not answer within");
    expect(host.running("agent-1")).toBe(false);
  });

  test("a slow gateway is waited for", async () => {
    const { engine, host } = await setup();
    host.extraEnv = { FAKE_HERMES_SLOW_MS: "400" };
    await engine.start(agentOf(), OFFICE);
    expect((await engine.health("agent-1")).ok).toBe(true);
  });
});

describe("talking to it", () => {
  test("a message is answered through the gateway, with the agent's document and its usage", async () => {
    const { engine, of, host } = await setup();
    await engine.start(agentOf(), OFFICE);
    await engine.send("agent-1", message("hello"));
    await engine.idle();
    expect(of("message")).toEqual([
      { type: "message", agentId: "agent-1", userId: "mia", text: "Hermes heard: hello" },
    ]);
    // What the turn used is charged to whoever's key ran it.
    expect(of("usage")).toHaveLength(1);
    expect(of("usage")[0]).toMatchObject({
      attributedTo: { userId: "mia" },
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0 },
    });
    expect(of("usage")[0]?.dedupeKey).toMatch(/^hermes:agent-1:run_/);
    const sessions = JSON.parse(
      await kept(join(host.home("agent-1"), "fake-sessions.json"), "Hermes heard: hello"),
    ) as Array<{ title?: string; messages: Array<{ system?: string }> }>;
    expect(sessions[0]?.title).toBe("Regulus Office: Number Two");
    expect(sessions[0]?.messages[0]?.system).toContain("Keep answers short.");
    expect(sessions[0]?.messages[0]?.system).toContain("the person you belong to");
  });

  test("a shared agent is refused: Hermes keeps one memory for everyone it talks to (#301)", async () => {
    const { engine, of, host } = await setup();
    const shared = agentOf({ ownerUserId: null, ownerName: null });
    expect(() => engine.check(shared)).toThrow(EngineRefusal);
    const err = await engine.start(shared, OFFICE).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(EngineRefusal);
    expect((err as EngineRefusal).code).toBe("personal_only");
    expect((err as EngineRefusal).message).toContain("a shared agent cannot run on Hermes for now");
    // Nothing was started for it.
    expect(existsSync(join(host.home("agent-1"), "fake-start.json"))).toBe(false);
    expect(of("status")).toEqual([]);
  });
});

describe("looking after the process", () => {
  test("a crashed gateway shows as Error with the reason, is started again, and continues the session", async () => {
    const { engine, host, of, started } = await setup();
    await engine.start(agentOf(), OFFICE);
    await engine.send("agent-1", message("before"));
    await engine.idle();
    const first = started();
    await kept(join(host.home("agent-1"), "fake-sessions.json"), "Hermes heard: before");

    host.kill("agent-1");
    await until(() => of("status").some((s) => s.status === "error"));
    const error = of("status").find((s) => s.status === "error");
    expect(error?.reason).toBe("Hermes stopped unexpectedly (it was killed). Starting it again.");
    await until(() => of("status").at(-1)?.status === "ready" && host.running("agent-1"));
    expect(started().pid).not.toBe(first.pid);
    // The same run, so the same key and token: the office's token was not minted anew.
    expect(started().env.API_SERVER_KEY).toBe(first.env.API_SERVER_KEY);
    expect((await engine.health("agent-1")).ok).toBe(true);

    await engine.send("agent-1", message("after", "m2"));
    await engine.idle();
    expect(of("message").map((m) => m.text)).toEqual([
      "Hermes heard: before",
      "Hermes heard: after",
    ]);
    // Hermes kept the session in its home: nobody is told that a conversation was lost.
    expect(of("error")).toEqual([]);
    expect(host.launches).toHaveLength(2);
  });

  test("the reason of a crash is what the gateway printed last, with every key cut out", async () => {
    const { engine, of, started, said, host } = await setup();
    await engine.start(agentOf(), OFFICE);
    const key = started().env.API_SERVER_KEY ?? "?";
    await engine.send("agent-1", message("fake:crash"));
    await until(() => of("status").some((s) => s.status === "error"));
    const reason = of("status").find((s) => s.status === "error")?.reason ?? "";
    expect(reason).toContain("exit code 7");
    expect(reason).toContain("out of cheese (API_SERVER_KEY=[hidden])");
    await until(() => host.launches.length === 2 && of("status").at(-1)?.status === "ready");
    await engine.idle();
    // The person whose message was in flight is told; nothing is sent twice.
    expect(of("error").length + of("message").length).toBeGreaterThan(0);
    for (const secret of [key, MODEL_KEY, OFFICE_TOKEN]) expect(said()).not.toContain(secret);
  });

  test("a gateway that hangs is noticed, killed and started again", async () => {
    const { engine, host, of, started } = await setup();
    await engine.start(agentOf(), OFFICE);
    const first = started().pid;
    host.kill("agent-1", "SIGSTOP");
    await until(() => of("status").some((s) => s.status === "error"));
    expect(of("status").find((s) => s.status === "error")?.reason).toBe(
      "Hermes stopped unexpectedly (it stopped answering). Starting it again.",
    );
    await until(() => of("status").at(-1)?.status === "ready" && started().pid !== first);
    expect((await engine.health("agent-1")).ok).toBe(true);
  });

  test("a gateway that keeps failing is retried with a growing pause until it comes back", async () => {
    const { engine, host, of } = await setup();
    await engine.start(agentOf(), OFFICE);
    host.extraEnv = { FAKE_HERMES_EXIT: "9" };
    host.kill("agent-1");
    await until(() => host.launches.length >= 4);
    const reasons = of("status")
      .filter((s) => s.status === "error")
      .map((s) => s.reason ?? "");
    expect(reasons[0]).toContain("Hermes stopped unexpectedly");
    expect(
      reasons.some(
        (r) => r.startsWith("Hermes did not start (exit code 9") && r.endsWith("Trying again."),
      ),
    ).toBe(true);
    expect(await engine.health("agent-1")).toEqual({
      ok: false,
      detail: "Hermes is being started again",
    });
    // Never "ready" while it is down.
    const lastError = of("status").findLastIndex((s) => s.status === "error");
    expect(
      of("status")
        .slice(lastError)
        .every((s) => s.status === "error"),
    ).toBe(true);

    host.extraEnv = {};
    await until(() => of("status").at(-1)?.status === "ready");
    await engine.send("agent-1", message("back?"));
    await engine.idle();
    expect(of("message").at(-1)?.text).toBe("Hermes heard: back?");
  });

  test("stop ends the process and keeps its home; forget removes the home", async () => {
    const { engine, host, of } = await setup();
    await engine.start(agentOf(), OFFICE);
    await engine.stop("agent-1");
    expect(host.running("agent-1")).toBe(false);
    expect(existsSync(join(host.home("agent-1"), "config.yaml"))).toBe(true);
    expect(await engine.health("agent-1")).toEqual({ ok: false, detail: "not started" });
    await refusal(engine.send("agent-1", message("anyone?")));
    // Stopped means stopped: nothing restarts it.
    const launches = host.launches.length;
    await Bun.sleep(120);
    expect(host.launches).toHaveLength(launches);
    expect(of("status").some((s) => s.status === "error")).toBe(false);

    await engine.forget("agent-1");
    expect(existsSync(host.home("agent-1"))).toBe(false);
  });

  test("a stop while it is being restarted wins", async () => {
    const { engine, host } = await setup();
    await engine.start(agentOf(), OFFICE);
    host.extraEnv = { FAKE_HERMES_SLOW_MS: "300" };
    host.kill("agent-1");
    await until(() => host.launches.length === 2);
    await engine.stop("agent-1");
    await Bun.sleep(450);
    expect(host.running("agent-1")).toBe(false);
    expect(host.launches).toHaveLength(2);
  });
});
