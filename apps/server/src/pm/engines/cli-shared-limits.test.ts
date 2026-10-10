/**
 * The hard case of #301 through the real CLI session engine, the office MCP
 * server and the fake `claude`: a shared agent writes a memory while helping
 * Mia about Apollo, and it does not surface when Sam, who cannot see Apollo,
 * talks to the same agent, neither in what the tools hand the agent nor in
 * the system prompt of his turn. Nothing here tells the office which room the
 * memory is about: the engine reports whose turn it is, and the office does
 * the rest.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  OFFICE_AGENTS_API_PATH,
  type OfficeAgentConversation,
  type OfficeAgentView,
} from "@regulus/protocol";
import { LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import { type AgentsOffice, APOLLO, agentsOffice, BOREALIS } from "../test-helpers.ts";

const FAKE_CLAUDE = join(import.meta.dir, "testing", "fake-claude.ts");
const A = OFFICE_AGENTS_API_PATH;
const CANARY = "APOLLOCANARY ships on Friday";

let o: AgentsOffice;
let runner: LocalTmuxRunner;
let pm: OfficeAgentView;

interface Report {
  turn: number;
  resumed: boolean;
  systemPrompt: string;
  operations: { operations: Array<{ id: string; name: string }> };
  board?: { error?: string; message?: string; issues?: unknown };
  remembered?: { id?: string; saved?: boolean; error?: string };
  recalled?: { memories: Array<{ text: string }>; notes: unknown[] };
}

beforeAll(async () => {
  runner = await LocalTmuxRunner.create();
  o = await agentsOffice({ runner, cliCommand: FAKE_CLAUDE });
  o.addOfficeKey();
  const res = await o.send(A, "POST", o.people.ada.cookie, {
    name: "Ledger",
    owner: "office",
    engine: "cli-session",
    role: "pm",
    provider: "claude-code",
    model: "sonnet",
    profileId: "office:claude-code",
  });
  if (res.status !== 201) throw new Error(await res.text());
  pm = (await res.json()) as OfficeAgentView;
  const granted = await o.send(`${A}/${pm.id}/grants`, "PUT", o.people.ada.cookie, {
    grants: [
      { operationId: APOLLO, access: "view" },
      { operationId: BOREALIS, access: "view" },
    ],
  });
  expect(granted.status).toBe(200);
});
afterAll(async () => {
  await o.stop();
  await runner.dispose();
});

async function talk(person: { cookie: string }, text: string): Promise<Report> {
  const sent = await o.send(`${A}/${pm.id}/messages`, "POST", person.cookie, { text });
  expect(sent.status).toBe(202);
  for (let i = 0; i < 800; i++) {
    const convo = (await (
      await o.send(`${A}/${pm.id}/conversation`, "GET", person.cookie)
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
const ids = (report: Report) => report.operations.operations.map((x) => x.id).sort();

describe("a shared agent on the CLI session engine answers within the asker's access", () => {
  test("helping Mia it sees Apollo only, and what it saves is kept with Apollo", async () => {
    const report = await talk(o.people.mia, `BOARD ${BOREALIS} REMEMBER ${CANARY}`);
    expect(ids(report)).toEqual([APOLLO]);
    // Borealis is granted to the agent and closed to Mia: for this turn it does not exist.
    expect(report.board).toMatchObject({ error: "not_found", message: "no such operation" });
    expect(report.remembered).toMatchObject({ saved: true });
    expect(report.systemPrompt).toContain("People see different rooms");
    expect(o.officeAgents.mind.list(pm.id, "memory").entries).toMatchObject([
      { text: CANARY, rooms: [APOLLO] },
    ]);
  });

  test("in Sam's chat with the same agent the memory does not surface", async () => {
    const report = await talk(o.people.sam, "RECALL APOLLOCANARY");
    expect(ids(report)).toEqual([BOREALIS]);
    expect(report.recalled).toEqual({ memories: [], notes: [] });
    expect(report.systemPrompt).not.toContain("CANARY");
    expect(report.systemPrompt).not.toContain("What you remember");
    // His whole conversation, as the office keeps it, holds nothing of it but the word he typed.
    const convo = await o.send(`${A}/${pm.id}/conversation`, "GET", o.people.sam.cookie);
    expect(await convo.text()).not.toMatch(/ships on Friday|op-apollo|Apollo/);
  });

  test("the office owner, who can see no room, gets none through the agent either", async () => {
    const report = await talk(o.people.olga, `BOARD ${APOLLO} RECALL APOLLOCANARY`);
    expect(ids(report)).toEqual([]);
    expect(report.board).toMatchObject({ error: "not_found", message: "no such operation" });
    expect(report.recalled).toEqual({ memories: [], notes: [] });
    expect(report.systemPrompt).not.toContain("CANARY");
  });

  test("for Mia and for an admin who can see Apollo it is there", async () => {
    const mia = await talk(o.people.mia, "RECALL APOLLOCANARY");
    expect(mia.recalled?.memories).toMatchObject([{ text: CANARY }]);
    expect(mia.systemPrompt).toContain(CANARY);
    const ada = await talk(o.people.ada, "RECALL APOLLOCANARY");
    expect(ids(ada)).toEqual([APOLLO, BOREALIS]);
    expect(ada.recalled?.memories).toMatchObject([{ text: CANARY }]);
    expect(ada.systemPrompt).toContain(CANARY);
  });

  test("when Mia loses Apollo, her next message starts a new session with nothing of it", async () => {
    // Her conversation so far runs in one Claude session, which holds what the agent read.
    const before = await talk(o.people.mia, "hello again");
    expect(before).toMatchObject({ resumed: true, turn: 3 });
    o.setRoomAccess(APOLLO, o.people.mia.id, null);
    const after = await talk(o.people.mia, `BOARD ${APOLLO} RECALL APOLLOCANARY`);
    expect(after).toMatchObject({ resumed: false, turn: 1 });
    expect(ids(after)).toEqual([]);
    expect(after.board).toMatchObject({ error: "not_found", message: "no such operation" });
    expect(after.recalled).toEqual({ memories: [], notes: [] });
    expect(after.systemPrompt).not.toContain("CANARY");
    // Back with access, the new session goes on; the memory is still the office's.
    o.setRoomAccess(APOLLO, o.people.mia.id, "spawn");
    const back = await talk(o.people.mia, "RECALL APOLLOCANARY");
    expect(back).toMatchObject({ resumed: true, turn: 2 });
    expect(back.recalled?.memories).toMatchObject([{ text: CANARY }]);
  });
});
