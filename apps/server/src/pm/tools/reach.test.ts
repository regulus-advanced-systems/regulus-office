/**
 * Everything a shared agent writes where other people read it carries the
 * rooms its conversation has read (#301): a chat line, a comment on a card, a
 * queued task's title and prompt, a henchman's prompt. The check is made in
 * one place for every tool that is classified as writing into a room
 * (`TOOL_REACH`, call.ts), and this test goes through the whole registry so a
 * tool that is added later cannot go unclassified or unchecked.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  OFFICE_AGENTS_API_PATH,
  OFFICE_TOOL_INPUTS,
  OFFICE_TOOLS,
  type OfficeAgentConversation,
  type OfficeAgentTokenCreated,
  type OfficeAgentView,
  type OfficeToolName,
  officeAgentStartOverPath,
  REACH_NOTICE,
  REACH_REFUSAL,
} from "@regulus/protocol";
import { githubIssues, tasks } from "../../db/schema/index.ts";
import { CANARY, errorOf, type LimitsOffice, limitsOffice } from "../asker-limits.fixture.ts";
import { type AgentsOffice, APOLLO, BOREALIS, BOREALIS_REPO } from "../test-helpers.ts";
import { TOOL_REACH } from "./call.ts";

let f: LimitsOffice;
let o: AgentsOffice;
let pm: OfficeAgentView;

/** Tools that change something and carry none of the agent's text to anyone: said here, one by one. */
const CARRIES_NO_TEXT: readonly OfficeToolName[] = [
  "stop_henchman",
  "memory_forget",
  "note_delete",
];

/** A call of each tool that writes into a room, aimed at Borealis, with the canary as its text. */
const INTO_BOREALIS: Partial<Record<OfficeToolName, (adaId: string) => Record<string, unknown>>> = {
  post_chat: () => ({ operationId: BOREALIS, text: CANARY }),
  comment_on_card: () => ({
    operationId: BOREALIS,
    repoId: BOREALIS_REPO,
    kind: "issue",
    number: 1,
    body: `status: ${CANARY}`,
  }),
  enqueue_task: (adaId) => ({
    operationId: BOREALIS,
    repoId: BOREALIS_REPO,
    kind: "freeform",
    title: `like ${CANARY}`,
    prompt: `context: ${CANARY}`,
    provider: "claude-code",
    model: "sonnet",
    onBehalfOf: adaId,
  }),
  spawn_henchman: (adaId) => ({
    operationId: BOREALIS,
    repoId: BOREALIS_REPO,
    provider: "claude-code",
    model: "sonnet",
    prompt: `context: ${CANARY}`,
    taskTitle: `like ${CANARY}`,
    onBehalfOf: adaId,
  }),
};

const written = () => ({
  chat: o.chat.length,
  comments: o.comments.length,
  tasks: o.db.select().from(tasks).all().length,
  henchmen: o.spawned.length,
});

beforeAll(async () => {
  f = await limitsOffice({ preset: "manager" });
  ({ o, pm } = f);
  o.db
    .insert(githubIssues)
    .values({
      repoId: BOREALIS_REPO,
      number: 1,
      title: "x",
      state: "open",
      ghUpdatedAt: new Date(),
    })
    .run();
});
afterAll(async () => {
  await o.stop();
});

describe("where a tool's text ends up is decided for every tool", () => {
  test("every tool in the registry is classified, and none that changes something is left as carrying nothing by default", () => {
    const names = OFFICE_TOOLS.map((t) => t.name).sort();
    expect(Object.keys(TOOL_REACH).sort()).toEqual(names);
    for (const tool of OFFICE_TOOLS) {
      const reach = TOOL_REACH[tool.name];
      if (tool.readOnly) expect([tool.name, reach]).toEqual([tool.name, "nothing"]);
      else if (reach === "nothing") expect(CARRIES_NO_TEXT).toContain(tool.name);
    }
    // Every tool that writes into a room has a call in this test.
    const intoRooms = names.filter((name) => TOOL_REACH[name] === "room");
    expect(Object.keys(INTO_BOREALIS).sort()).toEqual(intoRooms);
    expect(intoRooms.length).toBeGreaterThanOrEqual(4);
  });
});

describe("from a conversation that has read Apollo, nothing is written where people who cannot see Apollo read", () => {
  test("a chat line, a comment, a queued task and a henchman in Borealis are all refused, and nothing is written", async () => {
    const before = written();
    await f.during(o.people.ada, async () => {
      expect((await f.call("read_board", { operationId: APOLLO })).status).toBe(200);
      for (const [name, input] of Object.entries(INTO_BOREALIS)) {
        const refused = await f.call(name, input(o.people.ada.id));
        expect([name, refused.status, errorOf(refused)]).toEqual([name, 403, "forbidden"]);
        expect(JSON.stringify(refused.body)).not.toMatch(/apollo|CANARY/i);
      }
    });
    expect(written()).toEqual(before);
    // Sam, who sees Borealis only, reads its queue: nothing of Apollo is in it.
    await f.during(o.people.sam, async () => {
      const queue = await f.call("read_queue", { operationId: BOREALIS });
      expect(queue.status).toBe(200);
      expect(JSON.stringify(queue.body)).not.toContain("APOLLOCANARY");
    });
    // The lobby is read by everyone: nothing goes there either.
    await f.during(o.people.ada, async () => {
      expect(errorOf(await f.call("post_chat", { text: CANARY }))).toBe("forbidden");
    });
    expect(written()).toEqual(before);
  });

  test("from a conversation that has read Borealis only, the same calls go through", async () => {
    const before = written();
    // Sam administers Borealis, and his conversation has read nothing else.
    await f.during(o.people.sam, async () => {
      for (const [name, input] of Object.entries(INTO_BOREALIS)) {
        const done = await f.call(name, input(o.people.sam.id));
        expect([name, done.status]).toEqual([name, 200]);
      }
    });
    const after = written();
    expect([after.chat, after.comments, after.tasks]).toEqual([
      before.chat + 1,
      before.comments + 1,
      before.tasks + 1,
    ]);
    // The henchman it spawned, and the one the queue started for the task.
    expect(after.henchmen).toBeGreaterThan(before.henchmen);
  });
});

describe("the words of such a refusal", () => {
  const conversation = async (person: { cookie: string }) =>
    (await (
      await o.send(`${OFFICE_AGENTS_API_PATH}/${pm.id}/conversation`, "GET", person.cookie)
    ).json()) as OfficeAgentConversation;

  test("the agent is told why and what clears it; the person is told the same in their chat, once; no room is named", async () => {
    const notices = async () =>
      (await conversation(o.people.ada)).messages.filter((m) => m.text === REACH_NOTICE).length;
    const before = await notices();
    const turn = await f.turn(o.people.ada);
    for (const [name, input] of Object.entries(INTO_BOREALIS)) {
      const refused = await turn.call(name, input(o.people.ada.id));
      expect((refused.body as { message?: string }).message).toBe(REACH_REFUSAL);
    }
    expect(REACH_REFUSAL).toContain("starting this conversation over");
    expect(REACH_REFUSAL).toContain("looked at rooms that not everyone who reads there can see");
    for (const words of [REACH_REFUSAL, REACH_NOTICE]) {
      expect(words).not.toMatch(/apollo|borealis|octo/i);
    }
    // Four refusals in this turn: one line in Ada's chat, from the office.
    const ada = await conversation(o.people.ada);
    expect(await notices()).toBe(before + 1);
    expect(ada.messages.at(-1)).toMatchObject({ author: "system", text: REACH_NOTICE });
    // It is a notice, not an end: she is still waiting for the agent's answer.
    expect(ada.waiting).toBe(true);
    expect((await turn.call("list_operations")).status).toBe(200);
    f.done(o.people.ada);
    // Nobody else gets it.
    expect((await conversation(o.people.sam)).messages.some((m) => m.text === REACH_NOTICE)).toBe(
      false,
    );
  });
});

describe("acting for a person", () => {
  test("with an access code the agent acts only for the person who minted it, on every tool that acts for someone", async () => {
    const res = await o.send(
      `${OFFICE_AGENTS_API_PATH}/${pm.id}/tokens`,
      "POST",
      o.people.ada.cookie,
      {
        label: "script",
      },
    );
    const code = ((await res.json()) as OfficeAgentTokenCreated).token;
    // (Ada starts her conversation over, so that nothing it had looked at is what refuses below.)
    const cleared = await o.send(officeAgentStartOverPath(pm.id), "POST", o.people.ada.cookie);
    expect(cleared.status).toBe(200);
    const before = written();
    // Every tool whose input can name a person to act for.
    const onBehalf = OFFICE_TOOLS.map((t) => t.name).filter(
      (name) => "onBehalfOf" in OFFICE_TOOL_INPUTS[name].shape,
    );
    const calls: Record<string, (userId: string) => Record<string, unknown>> = {
      enqueue_task: (userId) => ({
        ...INTO_BOREALIS.enqueue_task?.(userId),
        operationId: APOLLO,
        repoId: "repo-apollo",
      }),
      spawn_henchman: (userId) => ({
        ...INTO_BOREALIS.spawn_henchman?.(userId),
        operationId: APOLLO,
        repoId: "repo-apollo",
      }),
      stop_henchman: (userId) => ({
        henchmanId: o.spawned[0]?.agentId ?? "none",
        onBehalfOf: userId,
      }),
    };
    expect(Object.keys(calls).sort()).toEqual([...onBehalf].sort());
    // Mia's turn is open: she is waiting for the agent. Ada's code still cannot act for her.
    const mias = await f.turn(o.people.mia);
    for (const [name, input] of Object.entries(calls)) {
      const asMia = await o.tool(code, name, input(o.people.mia.id));
      expect([name, asMia.status, errorOf(asMia)]).toEqual([name, 403, "not_waiting"]);
    }
    expect(written()).toEqual(before);
    // Mia's own turn can, for Mia.
    expect((await mias.call("enqueue_task", calls.enqueue_task?.(o.people.mia.id))).status).toBe(
      200,
    );
    f.done(o.people.mia);
  });
});
