/**
 * A conversation with an office agent ends and begins again (#301): an office
 * restart closes the turns it cut short, and a person can start their own
 * conversation over, which drops the agent's session with them and, for a
 * shared agent, what that conversation had looked at. Who is who is in
 * asker-limits.fixture.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  CONVERSATION_RESTARTED_LINE,
  type OfficeAgentConversation,
  type OfficeAgentView,
  officeAgentStartOverPath,
} from "@regulus/protocol";
import { and, eq } from "drizzle-orm";
import { officeAgentRoomReads } from "../db/schema/index.ts";
import { A, errorOf, type LimitsOffice, limitsOffice } from "./asker-limits.fixture.ts";
import { RESTART_LINE } from "./conversations.ts";
import { type AgentsOffice, APOLLO, BOREALIS } from "./test-helpers.ts";

let f: LimitsOffice;
let o: AgentsOffice;
let pm: OfficeAgentView;
const call: LimitsOffice["call"] = (name, input) => f.call(name, input);
const during: LimitsOffice["during"] = (person, fn) => f.during(person, fn);

beforeAll(async () => {
  f = await limitsOffice();
  ({ o, pm } = f);
});
afterAll(async () => {
  await o.stop();
});

describe("an office restart in the middle of a turn", () => {
  test("whoever was waiting is told, once, instead of waiting for an answer that cannot come", async () => {
    const { conversations } = o.officeAgents;
    const mias = await f.turn(o.people.mia, "are you there?");
    expect(conversations.waiting(pm.id, o.people.mia.id)).toBe(true);
    const sams = conversations.recent(pm.id, o.people.sam.id).length;
    o.officeAgents.boot();
    expect(conversations.waiting(pm.id, o.people.mia.id)).toBe(false);
    expect(conversations.recent(pm.id, o.people.mia.id).at(-1)).toMatchObject({
      author: "system",
      text: RESTART_LINE,
    });
    // The turn's token went with the restart, and nobody who was not waiting gets a line.
    expect((await mias.call("list_operations")).status).toBe(401);
    expect(conversations.recent(pm.id, o.people.sam.id)).toHaveLength(sams);
    // A second restart adds nothing.
    const lines = conversations.recent(pm.id, o.people.mia.id).length;
    o.officeAgents.boot();
    expect(conversations.recent(pm.id, o.people.mia.id)).toHaveLength(lines);
    mias.end();
  });
});

describe("starting a conversation over", () => {
  const startOver = (person: { cookie: string }, id = pm.id) =>
    o.send(officeAgentStartOverPath(id), "POST", person.cookie);
  const read = (userId: string) =>
    o.db
      .select({ operationId: officeAgentRoomReads.operationId })
      .from(officeAgentRoomReads)
      .where(and(eq(officeAgentRoomReads.agentId, pm.id), eq(officeAgentRoomReads.userId, userId)))
      .all()
      .map((r) => r.operationId);

  test("clears what the conversation had looked at, so the agent can write where it was refused; the lines stay", async () => {
    const { ada } = o.people;
    // (Sam's conversation has looked at Borealis: it is to stay as it is.)
    await during(o.people.sam, async () => {
      await call("read_board", { operationId: BOREALIS });
    });
    // Ada's conversation has looked at Apollo: a line into Borealis's chat is refused.
    await during(ada, async () => {
      await call("read_board", { operationId: APOLLO });
      expect(errorOf(await call("post_chat", { text: "hello", operationId: BOREALIS }))).toBe(
        "forbidden",
      );
    });
    expect(read(ada.id)).toContain(APOLLO);
    const before = o.officeAgents.conversations.recent(pm.id, ada.id);
    const forgotten = o.fake.forgotten.length;

    const res = await startOver(ada);
    expect(res.status).toBe(200);
    const convo = (await res.json()) as OfficeAgentConversation;
    // Everything she saw is still there, and a line marks where it begins again.
    expect(convo.messages.slice(0, -1).map((m) => m.id)).toEqual(before.map((m) => m.id));
    expect(convo.messages.at(-1)).toMatchObject({
      author: "system",
      text: CONVERSATION_RESTARTED_LINE,
    });
    expect(convo.waiting).toBe(false);
    // The engine dropped its session with her (and nobody else's), and the record is empty.
    expect(o.fake.forgotten.slice(forgotten)).toEqual([{ agentId: pm.id, userId: ada.id }]);
    expect(read(ada.id)).toEqual([]);
    expect(read(o.people.sam.id)).toEqual([BOREALIS]);
    expect(o.audits("office_agent.conversation_start_over").at(-1)).toMatchObject({
      userId: ada.id,
      targetId: pm.id,
    });
    // Now the same line goes through.
    const lines = o.chat.length;
    await during(ada, async () => {
      expect((await call("post_chat", { text: "hello", operationId: BOREALIS })).status).toBe(200);
    });
    expect(o.chat).toHaveLength(lines + 1);
  });

  test("an agent that is not running: the session it would continue is taken out of what the office keeps", async () => {
    const { store, runtime } = o.officeAgents;
    await runtime.stop(pm.id, "cli-session");
    store.update(pm.id, {
      engineState: JSON.stringify({
        sessions: { [o.people.sam.id]: "sams-session", [o.people.mia.id]: "mias-session" },
      }),
    });
    expect((await startOver(o.people.sam)).status).toBe(200);
    expect(JSON.parse(store.get(pm.id)?.engineState ?? "{}")).toEqual({
      sessions: { [o.people.mia.id]: "mias-session" },
    });
    expect(read(o.people.sam.id)).toEqual([]);
    // It did not start the agent.
    expect(runtime.isRunning(pm.id)).toBe(false);
  });

  test("only one's own conversation, with an agent one may talk to", async () => {
    const made = await o.send(A, "POST", o.people.mia.cookie, {
      name: "Quillon",
      owner: "me",
      engine: "cli-session",
      role: "assistant",
      provider: "claude-code",
      model: "sonnet",
    });
    const mine = (await made.json()) as OfficeAgentView;
    expect((await startOver(o.people.mia, mine.id)).status).toBe(200);
    // Someone else's personal agent: an admin who sees its card may not, anyone else finds none.
    expect((await startOver(o.people.ada, mine.id)).status).toBe(403);
    expect((await startOver(o.people.sam, mine.id)).status).toBe(404);
    expect(
      (await o.office.request(officeAgentStartOverPath(mine.id), { method: "POST" })).status,
    ).toBe(401);
    expect(
      (
        await o.send(
          officeAgentStartOverPath(mine.id),
          "POST",
          o.people.mia.cookie,
          undefined,
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
  });
});
