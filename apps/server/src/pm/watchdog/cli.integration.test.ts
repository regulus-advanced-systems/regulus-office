/**
 * The watchdog on the real CLI session engine (#253): the office's schedule
 * gives it one turn per room, the fake `claude` in a runner does each over
 * MCP, and the host is read by `ssh` (a stand-in) in the same runner
 * identity. Checks what a round turn's session is given: a turn token of the
 * office's own (#301's per-turn tokens), the three round tools and nothing else,
 * the office MCP server only, no memories, and a session that is not kept.
 */
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  OFFICE_AGENTS_API_PATH,
  type OfficeAgentConversation,
  WATCHDOG_HOSTS_API_PATH,
  WATCHDOG_SETTINGS_API_PATH,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { officeAgents, watchdogFindings, watchdogHosts } from "../../db/schema/index.ts";
import { LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import { OFFICE_AGENT_RUNNER_USER } from "../engines/cli-session.ts";
import type { InstructionResult } from "../instructions.ts";
import { type AgentsOffice, APOLLO, agentsOffice } from "../test-helpers.ts";
import { FAKE_KEYSCAN, FAKE_SSH, FIRST_HOST_KEY, STACK, TEST_PRIVATE_KEY } from "./testing/kit.ts";

// Every turn here starts real processes (the fake CLI, the ssh and pm2 stand-ins).
setDefaultTimeout(90_000);

const FAKE_CLAUDE = join(import.meta.dir, "..", "engines", "testing", "fake-claude.ts");

let o: AgentsOffice;
let runner: LocalTmuxRunner;
let agentId: string;
let home: string;
const results: InstructionResult[] = [];

interface Report {
  prompt: string;
  resumed: boolean;
  builtInTools: string;
  allowedTools: string;
  systemPrompt: string;
  mcpServers: string[];
  tools: string[];
  operations: unknown;
  round?: {
    signals: number;
    recorded: number;
    finished: { ok: boolean };
    memory: { rpcError?: string };
  };
  tokenOnArgv: boolean;
}

beforeAll(async () => {
  runner = await LocalTmuxRunner.create();
  o = await agentsOffice({
    runner,
    cliCommand: FAKE_CLAUDE,
    watchdog: { sshCommand: FAKE_SSH, keyscanCommand: FAKE_KEYSCAN },
  });
  o.officeAgents.runtime.onInstructed((result) => results.push(result));
  const ada = o.people.ada.cookie;
  const made = await o.send(OFFICE_AGENTS_API_PATH, "POST", ada, {
    name: "Cerberus",
    owner: "office",
    engine: "cli-session",
    role: "watchdog",
    provider: "claude-code",
    model: "haiku",
    instructions: "Payment provider outages are noise.",
    profileId: o.addOfficeKey(),
  });
  agentId = ((await made.json()) as { id: string }).id;
  await o.send(WATCHDOG_SETTINGS_API_PATH, "PATCH", ada, { enabled: true, agentId });
  const host = await o.send(WATCHDOG_HOSTS_API_PATH, "POST", ada, {
    label: "prod-1",
    host: "prod-1.example.com",
    username: "watchdog",
    privateKey: TEST_PRIVATE_KEY,
    apps: [{ name: "api", operationId: APOLLO }, { name: "worker" }],
  });
  expect(host.status).toBe(201);
  home = (await runner.provision({ userId: OFFICE_AGENT_RUNNER_USER })).home;
  await writeFile(
    join(home, "fake-pm2-state.json"),
    JSON.stringify({
      apps: [
        { name: "api", log: STACK },
        { name: "worker", status: "errored" },
      ],
    }),
  );
}, 90_000);
afterAll(async () => {
  await o.stop();
  await runner.dispose();
});

async function waitFor<T>(what: () => T | undefined): Promise<T> {
  for (let i = 0; i < 2400; i++) {
    const value = what();
    if (value !== undefined) return value;
    await Bun.sleep(25);
  }
  throw new Error("timed out");
}

test("a scheduled round is one turn per room, each with its own token and the round tools only", async () => {
  await o.officeAgents.watchdog.rounds.tick();
  await waitFor(() => (results.length === 2 ? true : undefined));
  expect(results.map((r) => r.ok)).toEqual([true, true]);
  const [office, apollo] = results.map((r) => JSON.parse(r.text) as Report);

  // Two turns, in the order of the parts: the worker (no room) and Apollo's api.
  expect([office?.round?.signals, apollo?.round?.signals]).toEqual([1, 2]);
  expect([office?.round?.recorded, apollo?.round?.recorded]).toEqual([1, 2]);
  expect(office?.round?.finished).toMatchObject({ ok: true });
  const [round] = o.officeAgents.watchdog.parts.rounds(1);
  expect(round).toMatchObject({ trigger: "schedule", state: "done" });
  expect(
    o.db
      .select()
      .from(watchdogFindings)
      .all()
      .map((f) => [f.scope, f.operationId])
      .sort(),
  ).toEqual(
    [
      ["office", null],
      ["room", APOLLO],
      ["room", APOLLO],
    ].sort(),
  );

  for (const report of [office, apollo]) {
    // The session: no built-in tool, the office's MCP server only, and of it the round tools only.
    expect(report?.builtInTools).toBe("");
    expect(report?.allowedTools).toBe("mcp__office");
    expect(report?.mcpServers).toEqual(["office"]);
    expect(report?.tools.sort()).toEqual([
      "watchdog_check",
      "watchdog_finish_round",
      "watchdog_record_finding",
    ]);
    // Any other tool does not exist for a round turn, memories among them.
    expect(report?.round?.memory.rpcError).toContain("unknown tool");
    expect(report?.operations).toMatchObject({ rpcError: expect.stringContaining("unknown tool") });
    // How it works is the watchdog's own frame, with its soul; no word of memories or notes.
    expect(report?.systemPrompt).toContain("this turn is one part of a round");
    expect(report?.systemPrompt).toContain("Payment provider outages are noise.");
    expect(report?.systemPrompt).not.toContain("memory_save");
    expect(report?.prompt).toContain("[From the office's schedule; nobody is waiting for a reply]");
    expect(report?.tokenOnArgv).toBe(false);
  }

  // The turn's token is in the session's 0600 config; it was the turn's own, and it is dead now.
  const dir = `${home}/.regulus-office/office-agents/${agentId}`;
  expect((await stat(join(dir, "mcp.json"))).mode & 0o777).toBe(0o600);
  const turnToken = /Bearer (roa_[\w-]+)/.exec(await readFile(join(dir, "mcp.json"), "utf8"))?.[1];
  expect(turnToken).toBeDefined();
  expect((await o.tool(turnToken ?? "", "watchdog_check")).status).toBe(401);

  // The SSH key was a 0600 file while ssh ran, and nothing of it is on the volume now.
  const calls = (await readFile(join(home, "fake-ssh.log"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { key: { mode: string } | null });
  expect(calls.every((c) => c.key?.mode === "600")).toBe(true);
  expect(
    await stat(join(dir, "watchdog")).then(
      () => true,
      () => false,
    ),
  ).toBe(false);
  // The host's key was stored on first contact.
  expect(o.db.select().from(watchdogHosts).get()).toMatchObject({
    hostKey: FIRST_HOST_KEY,
    hostKeySource: "learned",
  });

  // The round's sessions are not kept: the engine's state holds no session for them.
  const row = o.db.select().from(officeAgents).where(eq(officeAgents.id, agentId)).get();
  expect(JSON.parse(row?.engineState ?? "{}")).toEqual({});
});

test("in a person's conversation the same agent has its two conversation tools and nothing of a round", async () => {
  const cookie = o.people.mia.cookie;
  const sent = await o.send(`${OFFICE_AGENTS_API_PATH}/${agentId}/messages`, "POST", cookie, {
    text: "What can you see?",
  });
  expect(sent.status).toBe(202);
  let last: OfficeAgentConversation["messages"][number] | undefined;
  for (let i = 0; i < 2400 && (last === undefined || last.author === "person"); i++) {
    await Bun.sleep(25);
    const convo = (await (
      await o.send(`${OFFICE_AGENTS_API_PATH}/${agentId}/conversation`, "GET", cookie)
    ).json()) as OfficeAgentConversation;
    last = convo.messages.at(-1);
  }
  expect(last?.author).toBe("agent");
  const report = JSON.parse(last?.text ?? "{}") as Report;
  expect(report.tools.sort()).toEqual(["watchdog_read_report", "watchdog_request_round"]);
  expect(report.round).toBeUndefined();
  expect(report.systemPrompt).toContain("You keep no memories and no notes");
  expect(report.systemPrompt).not.toContain("this turn is one part of a round");
  // Its conversation with Mia is an ordinary one, kept across turns.
  const row = o.db.select().from(officeAgents).where(eq(officeAgents.id, agentId)).get();
  expect(Object.keys(JSON.parse(row?.engineState ?? "{}").sessions ?? {})).toEqual([
    o.people.mia.id,
  ]);
  // Its turn had a token of its own too (#301), bound to Mia; it is gone with the turn.
  const dir = `${home}/.regulus-office/office-agents/${agentId}`;
  const turnToken = /Bearer (roa_[\w-]+)/.exec(await readFile(join(dir, "mcp.json"), "utf8"))?.[1];
  expect(turnToken).toBeDefined();
  expect((await o.tool(turnToken ?? "", "watchdog_read_report")).status).toBe(401);
});
