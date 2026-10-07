/**
 * The CLI session engine and the agent's mind (#136): the soul is loaded when
 * the agent starts, what it remembers reaches every turn, the agent saves and
 * finds memories through the office MCP server, and none of it is on argv.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type MindEntriesResponse,
  OFFICE_AGENTS_API_PATH,
  type OfficeAgentConversation,
  type OfficeAgentsResponse,
  type OfficeAgentView,
  officeAgentMindPaths,
} from "@regulus/protocol";
import { LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import { type AgentsOffice, agentsOffice } from "../test-helpers.ts";
import { agentDir } from "./cli-plan.ts";

const FAKE_CLAUDE = join(import.meta.dir, "testing", "fake-claude.ts");
const A = OFFICE_AGENTS_API_PATH;

let o: AgentsOffice;
let runner: LocalTmuxRunner;
let agent: OfficeAgentView;

interface Report {
  systemPrompt: string;
  systemPromptOnArgv: boolean;
  remembered?: { id?: string; saved?: boolean; error?: string };
  recalled?: { memories: Array<{ text: string; source?: string }> };
}

beforeAll(async () => {
  runner = await LocalTmuxRunner.create();
  o = await agentsOffice({ runner, cliCommand: FAKE_CLAUDE });
  const res = await o.send(A, "POST", o.people.mia.cookie, {
    name: "Hermes",
    owner: "me",
    engine: "cli-session",
    role: "assistant",
    provider: "claude-code",
    model: "sonnet",
    instructions: "You are Mia's note taker. Keep a daily journal.",
  });
  agent = (await res.json()) as OfficeAgentView;
});
afterAll(async () => {
  await o.stop();
  await runner.dispose();
});

async function talk(text: string): Promise<Report> {
  const cookie = o.people.mia.cookie;
  const sent = await o.send(`${A}/${agent.id}/messages`, "POST", cookie, { text });
  expect(sent.status).toBe(202);
  for (let i = 0; i < 400; i++) {
    const convo = (await (
      await o.send(`${A}/${agent.id}/conversation`, "GET", cookie)
    ).json()) as OfficeAgentConversation;
    const last = convo.messages.at(-1);
    if (last && last.author !== "person") {
      expect(last.author).toBe("agent");
      return JSON.parse(last.text) as Report;
    }
    await Bun.sleep(25);
  }
  throw new Error("no answer");
}

describe("CLI session engine: soul and memories", () => {
  test("the soul is loaded at start, from a private file and not from argv", async () => {
    const report = await talk("Hello");
    expect(report.systemPrompt).toContain("You are Mia's note taker. Keep a daily journal.");
    expect(report.systemPrompt).toContain("only your owner can read them");
    expect(report.systemPromptOnArgv).toBe(false);
    const home = (await runner.provision({ userId: o.people.mia.id })).home;
    const file = join(agentDir(home, agent.id), "prompt.md");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, "utf8")).toBe(report.systemPrompt);
  });

  test("what the agent saves through MCP is in the office and in its next turn", async () => {
    const saved = await talk("REMEMBER Mia's standup moved to 9:30");
    expect(saved.remembered).toMatchObject({ saved: true });
    // Not yet in the turn that saved it; the office has it at once.
    expect(saved.systemPrompt).not.toContain("9:30");
    const list = (await (
      await o.send(
        `${officeAgentMindPaths(agent.id).entries}?kind=memory`,
        "GET",
        o.people.mia.cookie,
      )
    ).json()) as MindEntriesResponse;
    expect(list.entries).toMatchObject([
      { text: "Mia's standup moved to 9:30", source: "fake CLI", by: "agent" },
    ]);
    // A note she writes by hand in Settings reaches the agent too.
    await o.send(officeAgentMindPaths(agent.id).entries, "POST", o.people.mia.cookie, {
      kind: "note",
      title: "Reading list",
      text: "Thinking in Systems",
    });
    const next = await talk("RECALL standup");
    expect(next.recalled?.memories).toMatchObject([{ text: "Mia's standup moved to 9:30" }]);
    expect(next.systemPrompt).toContain("What you remember");
    expect(next.systemPrompt).toContain("Mia's standup moved to 9:30 (from: fake CLI)");
    expect(next.systemPrompt).toContain("- Reading list (changed ");
    expect(next.systemPromptOnArgv).toBe(false);
  });

  test("a changed soul is what the agent starts with at the next message", async () => {
    const saved = await o.send(officeAgentMindPaths(agent.id).soul, "PUT", o.people.mia.cookie, {
      content: "You are Mia's note taker. Answer in Croatian.",
    });
    expect(saved.status).toBe(200);
    const report = await talk("Hello again");
    expect(report.systemPrompt).toContain("Answer in Croatian.");
    expect(report.systemPrompt).not.toContain("Keep a daily journal.");
    // Its memories are still there: they belong to the agent, not to a version of its soul.
    expect(report.systemPrompt).toContain("Mia's standup moved to 9:30");
  });

  test("a secret the agent tries to remember is refused and never reaches the office", async () => {
    const report = await talk("REMEMBER the deploy key is sk-ant-api03-FAKEFAKEFAKEFAKE");
    expect(report.remembered).toMatchObject({ error: "secret_rejected" });
    expect(o.officeAgents.mind.list(agent.id, "memory").total).toBe(1);
  });

  test("an admin sees what it has cost on its card, and still nothing of what it is or knows", async () => {
    const res = await o.send(A, "GET", o.people.ada.cookie);
    const body = await res.text();
    const card = (JSON.parse(body) as OfficeAgentsResponse).agents.find((a) => a.id === agent.id);
    // Five turns of the fake CLI at $0.002 each.
    expect(card?.cost?.totalUsd).toBeCloseTo(0.01, 5);
    expect(card?.cost?.last30DaysUsd).toBeCloseTo(0.01, 5);
    expect(card).toMatchObject({ canConfigure: false, canRemove: true });
    for (const text of ["note taker", "Croatian", "standup", "Reading list"]) {
      expect(body).not.toContain(text);
    }
  });
});
