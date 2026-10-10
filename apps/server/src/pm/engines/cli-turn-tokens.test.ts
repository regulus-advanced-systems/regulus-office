/**
 * A turn's token on the real CLI session engine (#301), with the fake
 * `claude`: what the agent does in a turn is answered for the person whose
 * message it is, by the token written into that turn's MCP configuration,
 * and that token is gone when the turn is. So a run that is stopped while a
 * turn is in flight cannot lend its turn to the next person, and a process
 * that outlives its turn cannot ask the office anything. Also what is left
 * of a conversation the office starts over: nothing.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OFFICE_AGENTS_API_PATH,
  type OfficeAgentConversation,
  type OfficeAgentView,
} from "@regulus/protocol";
import { tasks } from "../../db/schema/index.ts";
import { LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import { type AgentsOffice, APOLLO, APOLLO_REPO, agentsOffice, BOREALIS } from "../test-helpers.ts";
import { agentDir } from "./cli-plan.ts";
import { OFFICE_AGENT_RUNNER_USER } from "./cli-session.ts";

const FAKE_CLAUDE = join(import.meta.dir, "testing", "fake-claude.ts");
const A = OFFICE_AGENTS_API_PATH;

let o: AgentsOffice;
let runner: LocalTmuxRunner;
let pm: OfficeAgentView;
let home = "";

interface Report {
  turn: number;
  resumed: boolean;
  systemPrompt: string;
  operations: { operations: Array<{ id: string }> };
  queued?: { error?: string; taskId?: string };
  remembered?: { saved?: boolean };
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
    preset: "manager",
    provider: "claude-code",
    model: "sonnet",
    profileId: "office:claude-code",
  });
  if (res.status !== 201) throw new Error(await res.text());
  pm = (await res.json()) as OfficeAgentView;
  await o.send(`${A}/${pm.id}/grants`, "PUT", o.people.ada.cookie, {
    grants: [
      { operationId: APOLLO, access: "manage" },
      { operationId: BOREALIS, access: "manage" },
    ],
  });
  home = (await runner.provision({ userId: OFFICE_AGENT_RUNNER_USER })).home;
});
afterAll(async () => {
  await o.stop();
  await runner.dispose();
});

const lastLine = async (person: { cookie: string }) => {
  const convo = (await (
    await o.send(`${A}/${pm.id}/conversation`, "GET", person.cookie)
  ).json()) as OfficeAgentConversation;
  return convo.messages.at(-1);
};
async function answer(person: { cookie: string }): Promise<Report> {
  for (let i = 0; i < 1200; i++) {
    const last = await lastLine(person);
    if (last && last.author === "agent") return JSON.parse(last.text) as Report;
    if (last && last.author === "system") throw new Error(`no answer: ${last.text}`);
    await Bun.sleep(25);
  }
  throw new Error("no answer");
}
async function talk(person: { cookie: string }, text: string): Promise<Report> {
  const sent = await o.send(`${A}/${pm.id}/messages`, "POST", person.cookie, { text });
  expect(sent.status).toBe(202);
  return answer(person);
}
/** The token the last turn's MCP configuration held. */
const tokenOnDisk = () => {
  const config = JSON.parse(readFileSync(join(agentDir(home, pm.id), "mcp.json"), "utf8")) as {
    mcpServers: { office: { headers: { Authorization: string } } };
  };
  return config.mcpServers.office.headers.Authorization.replace(/^Bearer /, "");
};
const transcripts = () => {
  const dir = join(home, ".claude", "projects", "fake");
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};

describe("each turn has a token of its own", () => {
  test("it is that person's, a new one every turn, and refused once the turn is over", async () => {
    const mia = await talk(o.people.mia, "hello");
    expect(mia.operations.operations.map((x) => x.id)).toEqual([APOLLO]);
    const first = tokenOnDisk();
    // What an orphaned process of that turn would send now is not answered.
    const late = await o.tool(first, "read_board", { operationId: APOLLO });
    expect(late.status).toBe(401);
    const sam = await talk(o.people.sam, "hello");
    expect(sam.operations.operations.map((x) => x.id)).toEqual([BOREALIS]);
    expect(tokenOnDisk()).not.toBe(first);
    expect((await o.tool(tokenOnDisk(), "list_operations")).status).toBe(401);
  });

  test("a run stopped while Mia's turn is in flight does not lend that turn to Ada, who writes next", async () => {
    const rt = o.officeAgents.runtime;
    const before = o.db.select().from(tasks).all().length;
    // (Ada sees Apollo only here, so that a task in Apollo is refused for no other reason
    // than whose turn it is.)
    o.setRoomAccess(BOREALIS, o.people.ada.id, null);
    // Mia's turn hangs in the CLI.
    const sent = await o.send(`${A}/${pm.id}/messages`, "POST", o.people.mia.cookie, {
      text: "SLEEP",
    });
    expect(sent.status).toBe(202);
    await Bun.sleep(400);
    // An admin stops the agent (or saves its document); Ada's message arrives while it stops.
    const stopping = rt.stop(pm.id, "cli-session");
    await Promise.resolve();
    const row = o.officeAgents.store.get(pm.id);
    if (!row) throw new Error("gone");
    await rt.deliver(
      row,
      { id: o.people.ada.id, displayName: "Ada" },
      `QUEUE ${APOLLO} ${APOLLO_REPO} ${o.people.mia.id}`,
    );
    await stopping;
    // The stop did not write "stopped" over the run Ada's message started.
    expect(o.officeAgents.store.get(pm.id)?.status).not.toBe("stopped");
    expect(rt.isRunning(pm.id)).toBe(true);
    const report = await answer(o.people.ada);
    // Ada's turn saw what Ada can see, and could not act for Mia.
    expect(report.operations.operations.map((x) => x.id)).toEqual([APOLLO]);
    expect(report.queued).toMatchObject({ error: "not_waiting" });
    o.setRoomAccess(BOREALIS, o.people.ada.id, "manage");
    expect(o.db.select().from(tasks).all()).toHaveLength(before);
    // Mia was told her message was not answered, and is not left waiting.
    expect((await lastLine(o.people.mia))?.author).toBe("system");
    expect(o.officeAgents.conversations.waiting(pm.id, o.people.mia.id)).toBe(false);
  }, 60_000);
});

describe("a conversation the office starts over leaves nothing behind", () => {
  test("when Mia loses Apollo, the CLI's transcript of her session and the last prompt are deleted before her next turn", async () => {
    const one = await talk(o.people.mia, `REMEMBER APOLLOCANARY ships on Friday`);
    expect(one.remembered).toMatchObject({ saved: true });
    const two = await talk(o.people.mia, "again");
    expect(two.resumed).toBe(true);
    expect(two.systemPrompt).toContain("APOLLOCANARY");
    const kept = transcripts();
    expect(kept.length).toBeGreaterThanOrEqual(2);
    const text = (name: string) =>
      readFileSync(join(home, ".claude", "projects", "fake", name), "utf8");
    const hers = kept.filter((name) => text(name).includes("APOLLOCANARY"));
    expect(hers).toHaveLength(1);
    expect(readFileSync(join(agentDir(home, pm.id), "prompt.md"), "utf8")).toContain(
      "APOLLOCANARY",
    );

    o.setRoomAccess(APOLLO, o.people.mia.id, null);
    const after = await talk(o.people.mia, "and now?");
    expect(after).toMatchObject({ resumed: false, turn: 1 });
    expect(after.systemPrompt).not.toContain("APOLLOCANARY");
    // Her old session's file is gone; other people's sessions are untouched.
    expect(transcripts()).not.toContain(hers[0]);
    for (const name of kept) if (name !== hers[0]) expect(transcripts()).toContain(name);
    for (const name of transcripts()) expect(text(name)).not.toContain("APOLLOCANARY");
    expect(readFileSync(join(agentDir(home, pm.id), "prompt.md"), "utf8")).not.toContain(
      "APOLLOCANARY",
    );
    o.setRoomAccess(APOLLO, o.people.mia.id, "spawn");
  }, 60_000);

  test("a turn that was running when the conversation was started over does not put its session back", async () => {
    const engine = o.officeAgents.runtime.engine("cli-session");
    if (!engine?.forgetConversation) throw new Error("no CLI session engine");
    const sessions = () =>
      (
        JSON.parse(o.officeAgents.store.get(pm.id)?.engineState ?? "{}") as {
          sessions?: Record<string, string>;
        }
      ).sessions ?? {};
    // Olga's first turn with the agent: no session is kept for her yet.
    expect(sessions()[o.people.olga.id]).toBeUndefined();
    const sent = await o.send(`${A}/${pm.id}/messages`, "POST", o.people.olga.cookie, {
      text: "hello",
    });
    expect(sent.status).toBe(202);
    // While it runs, her conversation is started over (she lost a room it had read).
    engine.forgetConversation(pm.id, o.people.olga.id);
    await answer(o.people.olga);
    expect(sessions()[o.people.olga.id]).toBeUndefined();
    // So her next message is a first turn again, not a continuation of that one.
    expect(await talk(o.people.olga, "hello again")).toMatchObject({ resumed: false, turn: 1 });
  }, 60_000);
});
