/**
 * A shared agent tells a person nothing about a room that person cannot see
 * (#301; D20, D26, D34), on the ways information leaves it other than its
 * memories (those are in memory-scope.test.ts):
 *
 * - what the office tools hand it while it answers that person;
 * - an access code a person minted for it;
 * - a question it puts to another person, and a chat line;
 * - its session with a person who has since lost a room.
 *
 * The limit follows the person it is answering, not the agent's grants and
 * not an office role. A real office server with sessions; who is who is in
 * asker-limits.fixture.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  OFFICE_AGENT_ATTENTION_API_PATH,
  OFFICE_AGENT_REQUESTS_API_PATH,
  type OfficeAgentAttention,
  type OfficeAgentTokenCreated,
  type OfficeAgentView,
} from "@regulus/protocol";
import { and, eq } from "drizzle-orm";
import { officeAgentRoomReads, officeAgentTokens } from "../db/schema/index.ts";
import {
  A,
  CANARY,
  errorOf,
  type LimitsOffice,
  limitsOffice,
  resultOf,
} from "./asker-limits.fixture.ts";
import { type AgentsOffice, APOLLO, APOLLO_REPO, BOREALIS } from "./test-helpers.ts";

let f: LimitsOffice;
let o: AgentsOffice;
let pm: OfficeAgentView;
const call: LimitsOffice["call"] = (name, input) => f.call(name, input);
const during: LimitsOffice["during"] = (person, fn) => f.during(person, fn);
const rooms = () => f.rooms();
const done: LimitsOffice["done"] = (person) => f.done(person);

beforeAll(async () => {
  f = await limitsOffice();
  ({ o, pm } = f);
});
afterAll(async () => {
  await o.stop();
});

describe("what the office tools hand a shared agent follows the person it is answering", () => {
  test("on its own it has its grants; answering someone it has only what they can see", async () => {
    expect((await rooms()).sort()).toEqual([APOLLO, BOREALIS]);
    expect(await during(o.people.mia, rooms)).toEqual([APOLLO]);
    expect(await during(o.people.sam, rooms)).toEqual([BOREALIS]);
    expect((await during(o.people.ada, rooms)).sort()).toEqual([APOLLO, BOREALIS]);
    // The office owner's role opens no room (D34): the agent's grants do not either.
    expect(await during(o.people.olga, rooms)).toEqual([]);
  });

  test("a room closed to that person answers exactly like one that does not exist", async () => {
    await during(o.people.mia, async () => {
      expect((await call("read_board", { operationId: APOLLO })).status).toBe(200);
      for (const name of ["read_board", "read_queue", "list_henchmen"]) {
        const closed = await call(name, { operationId: BOREALIS });
        const missing = await call(name, { operationId: "op-no-such-room" });
        expect(closed.status).toBe(404);
        expect(closed.body).toEqual(missing.body);
        expect(JSON.stringify(closed.body)).not.toMatch(/borealis|other|octo/i);
      }
      const usage = resultOf<{ usage: { topHenchmen: Array<{ agentId: string }> } }>(
        await call("read_usage"),
      );
      expect(usage.usage.topHenchmen.map((h) => h.agentId)).toEqual(["h-apollo"]);
      const comment = { repoId: "repo-borealis", kind: "issue", number: 1, body: "hi" };
      expect((await call("comment_on_card", { ...comment, operationId: BOREALIS })).status).toBe(
        404,
      );
    });
    expect(o.comments).toHaveLength(0);
  });

  test("it acts only for the person whose message it is working on", async () => {
    // Sam is waiting too, but the agent is answering Mia: it cannot use Sam's rights for her.
    await o.send(`${A}/${pm.id}/messages`, "POST", o.people.sam.cookie, { text: "and me?" });
    await during(o.people.mia, async () => {
      const task = {
        operationId: BOREALIS,
        repoId: "repo-borealis",
        kind: "freeform",
        prompt: "x",
        provider: "claude-code",
        model: "sonnet",
        onBehalfOf: o.people.sam.id,
      };
      expect(errorOf(await call("enqueue_task", task))).toBe("not_waiting");
      const forMia = { ...task, operationId: APOLLO, repoId: APOLLO_REPO };
      expect((await call("enqueue_task", { ...forMia, onBehalfOf: o.people.mia.id })).status).toBe(
        200,
      );
    });
    done(o.people.sam);
  });

  test("an engine that does not say whose turn it is: the lowest of everyone waiting decides", async () => {
    await o.send(`${A}/${pm.id}/messages`, "POST", o.people.mia.cookie, { text: "one" });
    expect(await rooms()).toEqual([APOLLO]);
    await o.send(`${A}/${pm.id}/messages`, "POST", o.people.sam.cookie, { text: "two" });
    // Mia cannot see Borealis and Sam cannot see Apollo: nothing is safe to hand over.
    expect(await rooms()).toEqual([]);
    o.fake.emit({ type: "message", agentId: pm.id, userId: o.people.mia.id, text: "Done." });
    expect(await rooms()).toEqual([BOREALIS]);
    o.fake.emit({ type: "message", agentId: pm.id, userId: o.people.sam.id, text: "Done." });
  });
});

describe("an access code reads what the person who minted it can see", () => {
  const mint = async (cookie: string) => {
    const res = await o.send(`${A}/${pm.id}/tokens`, "POST", cookie, { label: "script" });
    expect(res.status).toBe(201);
    return (await res.json()) as OfficeAgentTokenCreated;
  };
  const open = async (token: string) =>
    (
      (await o.tool(token, "list_operations")).body as unknown as {
        result: { operations: Array<{ id: string }> };
      }
    ).result.operations
      .map((x) => x.id)
      .sort();

  test("an office owner without access to the rooms gets none of them through the agent", async () => {
    const olgas = await mint(o.people.olga.cookie);
    expect(await open(olgas.token)).toEqual([]);
    const closed = await o.tool(olgas.token, "read_board", { operationId: APOLLO });
    const missing = await o.tool(olgas.token, "read_board", { operationId: "op-no-such-room" });
    expect(closed.status).toBe(404);
    expect(closed.body).toEqual(missing.body);
    const adas = await mint(o.people.ada.cookie);
    expect(await open(adas.token)).toEqual([APOLLO, BOREALIS]);
    // Access follows the person as they are now, not as they were when they minted it.
    o.setRoomAccess(BOREALIS, o.people.ada.id, null);
    expect(await open(adas.token)).toEqual([APOLLO]);
    o.setRoomAccess(BOREALIS, o.people.ada.id, "manage");

    // A code from before the office recorded who minted it opens no room.
    o.db
      .update(officeAgentTokens)
      .set({ mintedBy: null })
      .where(eq(officeAgentTokens.id, adas.id))
      .run();
    expect(await open(adas.token)).toEqual([]);
    expect((await o.tool(adas.token, "read_board", { operationId: APOLLO })).status).toBe(404);
  });
});

describe("what it passes on to somebody else", () => {
  test("a question goes only to someone who can see every room its conversation has read", async () => {
    let requestId = "";
    await during(o.people.mia, async () => {
      // Mia's conversation has read Apollo (above). Sam cannot see Apollo.
      const refused = await call("ask_human", {
        question: `Sam, about ${CANARY}`,
        userId: o.people.sam.id,
      });
      expect(errorOf(refused)).toBe("forbidden");
      expect(JSON.stringify(refused.body)).not.toMatch(/apollo|CANARY/i);
      const asked = await call("ask_human", { question: "Ada, ship it?", userId: o.people.ada.id });
      expect(asked.status).toBe(200);
      requestId = resultOf<{ requestId: string }>(asked).requestId;
    });
    expect(o.officeAgents.requests.pendingFor(o.people.sam.id)).toEqual([]);
    expect(o.officeAgents.requests.roomsOf(requestId)).toEqual([APOLLO]);

    // Answering Sam, the agent cannot read that question (or its answer) back.
    await during(o.people.sam, async () => {
      const closed = await call("read_human_request", { requestId });
      expect(closed.body).toEqual(
        (await call("read_human_request", { requestId: "no-such" })).body,
      );
    });
    // Ada loses Apollo before answering: the question is gone for her, by list and by id.
    const pending = async () =>
      (
        (await (
          await o.send(OFFICE_AGENT_REQUESTS_API_PATH, "GET", o.people.ada.cookie)
        ).json()) as { requests: Array<{ id: string }> }
      ).requests.map((r) => r.id);
    expect(await pending()).toContain(requestId);
    o.setRoomAccess(APOLLO, o.people.ada.id, null);
    expect(await pending()).not.toContain(requestId);
    const answer = await o.send(
      `${OFFICE_AGENT_REQUESTS_API_PATH}/${requestId}/answer`,
      "POST",
      o.people.ada.cookie,
      { answer: "yes" },
    );
    expect(answer.status).toBe(404);
    expect(await answer.text()).not.toContain("ship it");
    o.setRoomAccess(APOLLO, o.people.ada.id, "manage");
  });

  test("a chat line goes only where everyone reading can see those rooms", async () => {
    const lines = o.chat.length;
    await during(o.people.mia, async () => {
      // The lobby is read by everyone, Sam and Olga included.
      const lobby = await call("post_chat", { text: CANARY });
      expect(errorOf(lobby)).toBe("forbidden");
      expect(JSON.stringify(lobby.body)).not.toMatch(/apollo|CANARY/i);
      // Apollo's own chat is read by people who can enter Apollo.
      expect((await call("post_chat", { text: CANARY, operationId: APOLLO })).status).toBe(200);
      // Borealis is closed to Mia: for her it does not exist.
      expect((await call("post_chat", { text: CANARY, operationId: BOREALIS })).status).toBe(404);
    });
    expect(o.chat.slice(lines).map((l) => l.operationId)).toEqual([APOLLO]);
    // Ada's conversation has read Apollo; in Borealis's chat Sam would read it.
    await during(o.people.ada, async () => {
      expect(errorOf(await call("post_chat", { text: CANARY, operationId: BOREALIS }))).toBe(
        "forbidden",
      );
    });
    expect(o.chat).toHaveLength(lines + 1);
  });
});

describe("a person who loses a room their conversation had read", () => {
  const read = (userId: string) =>
    o.db
      .select({ operationId: officeAgentRoomReads.operationId })
      .from(officeAgentRoomReads)
      .where(and(eq(officeAgentRoomReads.agentId, pm.id), eq(officeAgentRoomReads.userId, userId)))
      .all()
      .map((r) => r.operationId);
  const attention = async (cookie: string) => {
    const res = await o.send(OFFICE_AGENT_ATTENTION_API_PATH, "GET", cookie);
    const text = await res.clone().text();
    return { text, mine: ((await res.json()) as OfficeAgentAttention).agents };
  };

  test("the agent's session with them starts over, and its open question is no longer shown", async () => {
    const { mia } = o.people;
    expect(read(mia.id)).toContain(APOLLO);
    o.officeAgents.requests.create({
      agentId: pm.id,
      forUserId: mia.id,
      question: "Ship Apollo tonight?",
      options: [],
      rooms: [APOLLO],
    });
    expect((await attention(mia.cookie)).mine.find((a) => a.agentId === pm.id)?.question).toBe(
      "Ship Apollo tonight?",
    );
    // While she can see Apollo her conversation goes on as it is.
    await during(mia, async () => {});
    expect(o.fake.forgotten).toEqual([]);

    o.setRoomAccess(APOLLO, mia.id, null);
    const after = await attention(mia.cookie);
    expect(after.mine.find((a) => a.agentId === pm.id)?.question).toBeUndefined();
    expect(after.text).not.toContain("Ship Apollo");
    // Her next message: the engine is told to drop its session with her before it gets the
    // message, and the record of what that conversation had read goes with it.
    await during(mia, async () => {
      expect(o.fake.forgotten).toEqual([{ agentId: pm.id, userId: mia.id }]);
      expect(read(mia.id)).toEqual([]);
      expect(await rooms()).toEqual([]);
    });
    // Nobody else's conversation is touched.
    expect(read(o.people.ada.id)).toContain(APOLLO);
    o.setRoomAccess(APOLLO, mia.id, "spawn");
  });
});
