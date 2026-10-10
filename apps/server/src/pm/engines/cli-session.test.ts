/**
 * The CLI session engine end to end (#271): a person's message becomes one
 * headless turn of the fake `claude` in a runner, which reaches the office
 * MCP server with the agent's session token, and its answer is stored as the
 * reply. Also the plan itself: what is on argv, in env and in files.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Secret } from "@regulus/agent-adapters";
import {
  OFFICE_AGENTS_API_PATH,
  type OfficeAgentConversation,
  type OfficeAgentView,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { officeAgents, tasks, usageSamples } from "../../db/schema/index.ts";
import { LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import {
  type AgentsOffice,
  APOLLO,
  APOLLO_REPO,
  agentsOffice,
  OFFICE_KEY,
} from "../test-helpers.ts";
import { buildClaudeTurn, parseClaudeTurn } from "./cli-plan.ts";
import { CliSessionEngine, OFFICE_AGENT_RUNNER_USER } from "./cli-session.ts";
import { AgentCredentials } from "./credentials.ts";
import { EMPTY_MIND, type EngineAgent, type EngineEvent } from "./types.ts";

const FAKE_CLAUDE = join(import.meta.dir, "testing", "fake-claude.ts");
const A = OFFICE_AGENTS_API_PATH;

let o: AgentsOffice;
let runner: LocalTmuxRunner;

beforeAll(async () => {
  runner = await LocalTmuxRunner.create();
  o = await agentsOffice({ runner, cliCommand: FAKE_CLAUDE });
  o.addOfficeKey();
});
afterAll(async () => {
  await o.stop();
  await runner.dispose();
});

interface Report {
  turn: number;
  resumed: boolean;
  prompt: string;
  model: string;
  builtInTools: string;
  allowedTools: string;
  systemPrompt: string;
  tools: string[];
  operations: { operations: Array<{ id: string }> };
  queued?: { taskId?: string; error?: string };
  hasApiKey: boolean;
  tokenOnArgv: boolean;
  home: string;
  cwd: string;
}

async function create(cookie: string, body: Record<string, unknown>) {
  const res = await o.send(A, "POST", cookie, {
    engine: "cli-session",
    role: "assistant",
    provider: "claude-code",
    model: "sonnet",
    ...body,
  });
  return { status: res.status, agent: (await res.json()) as OfficeAgentView & { error?: string } };
}

/** Say something and wait for the answer (or the system line that replaces it). */
async function talk(cookie: string, agentId: string, text: string) {
  const sent = await o.send(`${A}/${agentId}/messages`, "POST", cookie, { text });
  expect(sent.status).toBe(202);
  for (let i = 0; i < 400; i++) {
    const convo = (await (
      await o.send(`${A}/${agentId}/conversation`, "GET", cookie)
    ).json()) as OfficeAgentConversation;
    const last = convo.messages.at(-1);
    if (last && last.author !== "person") return last;
    await Bun.sleep(25);
  }
  throw new Error("no answer");
}

describe("CLI session engine", () => {
  test("a personal agent runs in its owner's runner, on their login, with only the office MCP tools", async () => {
    const { agent } = await create(o.people.mia.cookie, {
      name: "Hermes",
      owner: "me",
      instructions: "Keep answers short.",
    });
    const first = await talk(o.people.mia.cookie, agent.id, "What can you see?");
    expect(first.author).toBe("agent");
    const report = JSON.parse(first.text) as Report;
    expect(report).toMatchObject({
      turn: 1,
      resumed: false,
      model: "sonnet",
      builtInTools: "",
      allowedTools: "mcp__office",
      hasApiKey: false,
      tokenOnArgv: false,
    });
    // Her runner identity's HOME, and the agent's own folder in it.
    const home = (await runner.provision({ userId: o.people.mia.id })).home;
    expect(report.home).toBe(home);
    expect(report.cwd).toBe(`${home}/.regulus-office/office-agents/${agent.id}`);
    expect(report.prompt).toBe(`[From Mia, user id ${o.people.mia.id}]\nWhat can you see?`);
    expect(report.systemPrompt).toContain("personal agent of Mia");
    expect(report.systemPrompt).toContain("Keep answers short.");
    // Through MCP with its session token it has its owner's view of the office.
    expect(report.tools).toContain("enqueue_task");
    expect(report.tools).not.toContain("spawn_henchman");
    expect(report.operations.operations.map((x) => x.id)).toEqual([APOLLO]);
    // The token is in a 0600 file in that HOME only.
    const mcpFile = join(report.cwd, "mcp.json");
    expect((await stat(mcpFile)).mode & 0o777).toBe(0o600);
    expect(await readFile(mcpFile, "utf8")).toMatch(/Bearer roa_/);

    // The second turn resumes the same session; the session survives a stop and start.
    const second = JSON.parse((await talk(o.people.mia.cookie, agent.id, "And now?")).text);
    expect(second).toMatchObject({ turn: 2, resumed: true });
    expect((await o.send(`${A}/${agent.id}/stop`, "POST", o.people.mia.cookie)).status).toBe(200);
    const oldToken = /Bearer (roa_[\w-]+)/.exec(await readFile(mcpFile, "utf8"))?.[1] ?? "";
    expect((await o.tool(oldToken, "list_operations")).status).toBe(401);
    const third = JSON.parse((await talk(o.people.mia.cookie, agent.id, "Still you?")).text);
    expect(third).toMatchObject({ turn: 3, resumed: true });
    // Usage on her own login is hers.
    const usage = o.db.select().from(usageSamples).all();
    expect(usage).toHaveLength(3);
    expect(usage.every((u) => u.userId === o.people.mia.id && u.inputTokens === 120)).toBe(true);
  });

  test("a shared agent runs as the office's own identity on the office key, one session per person", async () => {
    const { agent } = await create(o.people.ada.cookie, {
      name: "Number Two",
      owner: "office",
      role: "pm",
      profileId: "office:claude-code",
    });
    await o.send(`${A}/${agent.id}/grants`, "PUT", o.people.ada.cookie, {
      grants: [{ operationId: APOLLO, access: "spawn" }],
    });
    const mia = JSON.parse(
      (
        await talk(
          o.people.mia.cookie,
          agent.id,
          `QUEUE ${APOLLO} ${APOLLO_REPO} ${o.people.mia.id}`,
        )
      ).text,
    ) as Report;
    const officeHome = (await runner.provision({ userId: OFFICE_AGENT_RUNNER_USER })).home;
    expect(mia).toMatchObject({ turn: 1, hasApiKey: true, tokenOnArgv: false, home: officeHome });
    expect(mia.systemPrompt).toContain("shared agent of the office");
    // During Mia's turn it queued a task for her: hers, on the office key.
    const row = o.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, mia.queued?.taskId ?? ""))
      .get();
    expect(row).toMatchObject({ createdBy: o.people.mia.id, profileId: "office:claude-code" });
    // Sam talks to the same agent in a session of his own, and it cannot act for Mia in it.
    const sam = JSON.parse(
      (
        await talk(
          o.people.sam.cookie,
          agent.id,
          `QUEUE ${APOLLO} ${APOLLO_REPO} ${o.people.mia.id}`,
        )
      ).text,
    ) as Report;
    expect(sam).toMatchObject({ turn: 1, resumed: false });
    expect(sam.queued?.error).toBe("not_waiting");
    const state = JSON.parse(
      o.db.select().from(officeAgents).where(eq(officeAgents.id, agent.id)).get()?.engineState ??
        "{}",
    ) as { sessions: Record<string, string> };
    expect(Object.keys(state.sessions).sort()).toEqual([o.people.mia.id, o.people.sam.id].sort());
    expect(state.sessions[o.people.mia.id]).not.toBe(state.sessions[o.people.sam.id]);
    // Office key usage is the office's, whoever asked.
    const office = o.db
      .select()
      .from(usageSamples)
      .all()
      .filter((u) => u.userId === null);
    expect(office).toHaveLength(2);
    // The key never reached a log line.
    expect(o.log.text()).not.toContain(OFFICE_KEY);
  });

  test("a failed turn is answered with a system line and the agent stays usable", async () => {
    const { agent } = await create(o.people.sam.cookie, { name: "Sams helper", owner: "me" });
    const failed = await talk(o.people.sam.cookie, agent.id, "FAIL please");
    expect(failed).toMatchObject({
      author: "system",
      text: "the CLI reported error_during_execution",
    });
    const fine = await talk(o.people.sam.cookie, agent.id, "hello");
    expect(JSON.parse(fine.text)).toMatchObject({ turn: 1, resumed: false });
  });

  test("Codex is refused for now, clearly, before anything is stored", async () => {
    const made = await create(o.people.sam.cookie, {
      name: "Codex helper",
      owner: "me",
      provider: "codex",
    });
    expect(made.status).toBe(400);
    expect(made.agent.error).toBe("provider_not_supported");
  });
});

describe("a turn that hangs", () => {
  test("is killed at the timeout and reported; stopping the agent kills a turn in flight", async () => {
    const engine = new CliSessionEngine({
      runner,
      credentials: new AgentCredentials(o.db, o.keyring),
      logger: o.log.logger,
      command: FAKE_CLAUDE,
      turnTimeoutMs: 400,
    });
    const events: EngineEvent[] = [];
    engine.onEvent((e) => events.push(e));
    const agent: EngineAgent = {
      id: crypto.randomUUID(),
      name: "Sleepy",
      role: "assistant",
      preset: "observer",
      ownerUserId: o.people.sam.id,
      ownerName: "Sam",
      provider: "claude-code",
      model: "sonnet",
      effort: null,
      profileId: null,
      instructions: "",
      state: {},
    };
    const office = {
      mcpUrl: "http://127.0.0.1:9/mcp",
      toolsUrl: "",
      token: Secret.of("roa_x"),
      mind: EMPTY_MIND,
    };
    const message = { id: "m1", userId: o.people.sam.id, fromName: "Sam", text: "SLEEP" };
    await engine.start(agent, office);
    await engine.send(agent.id, message);
    await engine.idle(agent.id);
    expect(events.find((e) => e.type === "error")).toMatchObject({
      userId: o.people.sam.id,
      message: "the agent did not answer within 1 min",
    });
    expect((await engine.health(agent.id)).ok).toBe(false);

    events.length = 0;
    await engine.send(agent.id, { ...message, id: "m2" });
    await Bun.sleep(100);
    const before = Date.now();
    await engine.stop(agent.id);
    expect(Date.now() - before).toBeLessThan(350);
    // A stopped agent answers nothing more; the person whose turn was cut short is told so,
    // once, so that they are not left waiting (#301).
    expect(events.filter((e) => e.type === "message")).toEqual([]);
    expect(events.filter((e) => e.type === "error")).toMatchObject([
      { type: "error", message: "the agent was stopped" },
    ]);
    expect(await engine.health(agent.id)).toEqual({ ok: false, detail: "not started" });
    await expect(engine.send(agent.id, message)).rejects.toThrow("not started");
  });
});

describe("the turn plan", () => {
  const agent: EngineAgent = {
    id: "0b0e7a1c-1111-4222-8333-444455556666",
    name: "Watchdog",
    role: "watchdog",
    preset: "observer",
    ownerUserId: null,
    ownerName: null,
    provider: "claude-code",
    model: "deepseek-chat",
    effort: "low",
    profileId: "office:claude-code",
    instructions: "",
    state: {},
  };
  const base = {
    agent,
    home: "/home/officeagents",
    backend: "docker" as const,
    mcpUrl: "http://office:3000/mcp",
    token: Secret.of("roa_SECRET-TOKEN"),
    sessionId: "11111111-2222-4333-8444-555555555555",
    resume: false,
    prompt: "-rf is not a flag here",
  };

  test("a board helper's turn runs with the CLI's own memory off; other agents are as before (#56)", () => {
    const credential = {
      kind: "base_url_key",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKey: Secret.of("sk-FAKE-deepseek"),
      attributedTo: "office",
    } as const;
    const helper = buildClaudeTurn({
      ...base,
      credential,
      agent: { ...base.agent, role: "kiosk", kiosk: { operationId: "op-1", board: "issues" } },
    });
    expect(helper.env.reveal()).toMatchObject({
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
    });
    // No tool of its own to write a file with, either.
    expect(helper.argv.join(" ")).toContain("--tools  --allowedTools mcp__office");
    const other = Object.keys(buildClaudeTurn({ ...base, credential }).env.reveal());
    expect(other.filter((k) => k.startsWith("CLAUDE_CODE_DISABLE_"))).toEqual([
      "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    ]);
  });

  test("secrets are in env and a 0600 file, never on argv; a DeepSeek profile sets the base URL", () => {
    const plan = buildClaudeTurn({
      ...base,
      credential: {
        kind: "base_url_key",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKey: Secret.of("sk-FAKE-deepseek"),
        attributedTo: "office",
      },
    });
    const argv = plan.argv.join("\n");
    expect(argv).not.toContain("roa_SECRET-TOKEN");
    expect(argv).not.toContain("sk-FAKE-deepseek");
    expect(JSON.stringify(plan)).not.toContain("sk-FAKE-deepseek");
    expect(JSON.stringify(plan)).not.toContain("roa_SECRET-TOKEN");
    const env = plan.env.reveal();
    expect(env).toMatchObject({
      HOME: "/home/officeagents",
      IS_SANDBOX: "1",
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_AUTH_TOKEN: "sk-FAKE-deepseek",
    });
    expect(plan.files.map((f) => [f.path, f.mode])).toEqual([
      [`${plan.cwd}/mcp.json`, 0o600],
      [`${plan.cwd}/prompt.md`, 0o600],
    ]);
    expect(plan.argv).toEqual(
      expect.arrayContaining([
        "-p",
        "--strict-mcp-config",
        "--session-id",
        "--model",
        "deepseek-chat",
      ]),
    );
    expect(plan.argv[plan.argv.indexOf("--tools") + 1]).toBe("");
    // A prompt that starts with a dash stays a prompt.
    expect(plan.argv.at(-1)).toBe(" -rf is not a flag here");
  });

  test("a resumed turn passes --resume; bad session ids and models never reach argv", () => {
    const login = { kind: "cli_login" as const };
    const plan = buildClaudeTurn({ ...base, resume: true, credential: login });
    expect(plan.argv).toContain("--resume");
    expect(plan.argv).not.toContain("--session-id");
    expect(Object.keys(plan.env.reveal()).filter((k) => k.startsWith("ANTHROPIC"))).toEqual([]);
    expect(() => buildClaudeTurn({ ...base, sessionId: "x; rm", credential: login })).toThrow();
    expect(() =>
      buildClaudeTurn({ ...base, agent: { ...agent, model: "a b" }, credential: login }),
    ).toThrow();
  });

  test("reading the CLI's answer", () => {
    const ok = parseClaudeTurn(
      `warning\n${JSON.stringify({ type: "result", is_error: false, result: " Done. ", total_cost_usd: 0.01, usage: { input_tokens: 3, output_tokens: 4 } })}\n`,
    );
    expect(ok).toMatchObject({
      reply: "Done.",
      error: null,
      usage: { inputTokens: 3, costUsd: 0.01 },
    });
    expect(parseClaudeTurn("not json").error).toBe("the CLI gave no result");
    expect(
      parseClaudeTurn(
        JSON.stringify({ type: "result", is_error: true, subtype: "error_max_turns" }),
      ).error,
    ).toBe("the CLI reported error_max_turns");
  });
});
