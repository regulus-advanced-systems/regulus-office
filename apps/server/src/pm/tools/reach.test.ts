/**
 * Everything a shared agent writes where other people read it carries the
 * rooms its conversation has read (#301): a chat line, a comment on a card, a
 * queued task's title and prompt, a henchman's prompt. The check is made in
 * one place for every tool that is classified as writing into a room
 * (`TOOL_REACH`, call.ts), and this test goes through the whole registry so a
 * tool that is added later cannot go unclassified or unchecked.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OFFICE_TOOLS, type OfficeAgentView, type OfficeToolName } from "@regulus/protocol";
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
