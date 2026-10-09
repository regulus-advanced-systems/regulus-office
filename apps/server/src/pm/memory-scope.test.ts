/**
 * The hard case of #301: a memory a shared agent wrote while helping one
 * person about a room does not surface for a person who cannot see that room,
 * neither in a later chat with the same agent nor for an admin reading its
 * memories in Settings. How a memory carries its rooms: the office stamps it
 * with the rooms the conversation it was written in had read (pm/scope.ts);
 * the agent declares nothing. Who is who is in asker-limits.fixture.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type MindEntriesResponse,
  type OfficeAgentView,
  officeAgentMindPaths,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { MIGRATIONS_DIR } from "../db/index.ts";
import { officeAgentMemories } from "../db/schema/index.ts";
import { CANARY, type LimitsOffice, limitsOffice, resultOf } from "./asker-limits.fixture.ts";
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

describe("a memory written while helping one person does not surface for another", () => {
  const P = () => officeAgentMindPaths(pm.id);
  let memoryId = "";
  const listed = async (cookie: string, query = "") => {
    const res = await o.send(`${P().entries}?kind=memory${query}`, "GET", cookie);
    return { status: res.status, text: await res.clone().text(), body: await res.json() } as {
      status: number;
      text: string;
      body: MindEntriesResponse;
    };
  };
  const digestFor = (userId?: string) => {
    const run = o.fake.started.get(pm.id);
    if (!run) throw new Error("the agent is not started");
    return run.office.mind.digest(userId);
  };

  test("what it saves takes the rooms its conversation has read, without being told", async () => {
    await during(o.people.mia, async () => {
      expect((await call("read_board", { operationId: APOLLO })).status).toBe(200);
      const saved = await call("memory_save", { text: CANARY, source: "Mia, in chat" });
      memoryId = resultOf<{ id: string }>(saved).id;
      expect(
        (await call("note_write", { title: "Apollo plan", text: `Plan: ${CANARY}` })).status,
      ).toBe(200);
    });
    const row = o.db
      .select()
      .from(officeAgentMemories)
      .where(eq(officeAgentMemories.id, memoryId))
      .get();
    expect(JSON.parse(row?.roomScope ?? "null")).toEqual([APOLLO]);
    // In a later turn of the same conversation it reads nothing and saves again: the
    // conversation still holds what it read before, so the scope is the same.
    await during(o.people.mia, async () => {
      const again = await call("memory_save", { text: "Mia likes short briefs" });
      const later = o.db
        .select()
        .from(officeAgentMemories)
        .where(eq(officeAgentMemories.id, resultOf<{ id: string }>(again).id))
        .get();
      expect(JSON.parse(later?.roomScope ?? "null")).toEqual([APOLLO]);
    });
  });

  test("answering someone who cannot see that room, it is not there: not listed, counted or found", async () => {
    for (const person of [o.people.sam, o.people.olga]) {
      await during(person, async () => {
        const list = resultOf<{ memories: unknown[]; total: number }>(await call("memory_list"));
        expect(list).toMatchObject({ memories: [], total: 0 });
        const found = await call("memory_search", { query: "APOLLOCANARY" });
        expect(resultOf<{ memories: unknown[]; notes: unknown[] }>(found)).toEqual({
          memories: [],
          notes: [],
        });
        expect(
          resultOf<{ notes: unknown[]; total: number }>(await call("note_list")),
        ).toMatchObject({ notes: [], total: 0 });
        // By id and by title it answers like something that does not exist.
        const closed = await call("note_read", { title: "Apollo plan" });
        expect(closed.body).toEqual((await call("note_read", { title: "No such note" })).body);
        const forget = await call("memory_forget", { id: memoryId });
        expect(forget.body).toEqual((await call("memory_forget", { id: "no-such-id" })).body);
        expect((await call("note_delete", { title: "Apollo plan" })).status).toBe(404);
        // Its title cannot be taken over either, and the refusal says nothing of the note.
        const taken = await call("note_write", { title: "apollo  PLAN", text: "mine now" });
        expect(taken.body.ok).toBe(false);
        expect(JSON.stringify(taken.body)).not.toContain("CANARY");
      });
      // What its engine puts in front of it for this person holds none of it.
      expect(digestFor(person.id)).not.toContain("CANARY");
      expect(digestFor(person.id)).not.toContain("Apollo plan");
    }
    // Nothing was forgotten or overwritten on the way.
    expect(o.officeAgents.mind.entry(pm.id, memoryId).text).toBe(CANARY);
    expect(o.officeAgents.mind.note(pm.id, "Apollo plan").text).toBe(`Plan: ${CANARY}`);
  });

  test("for people who can see the room it is there, and for nobody in particular it is not", async () => {
    for (const person of [o.people.mia, o.people.ada]) {
      await during(person, async () => {
        const found = await call("memory_search", { query: "APOLLOCANARY" });
        expect(resultOf<{ memories: unknown[] }>(found).memories).toHaveLength(1);
        expect((await call("note_read", { title: "Apollo plan" })).status).toBe(200);
      });
      expect(digestFor(person.id)).toContain(CANARY);
    }
    expect(digestFor()).not.toContain("CANARY");
  });

  test("reading it brings its room into that conversation: what is saved next carries it", async () => {
    // Ada has read nothing through a tool in this turn, only the memory about Apollo.
    await during(o.people.ada, async () => {
      await call("memory_search", { query: "APOLLOCANARY" });
      const saved = await call("memory_save", { text: "Ada asked about the launch" });
      const row = o.db
        .select()
        .from(officeAgentMemories)
        .where(eq(officeAgentMemories.id, resultOf<{ id: string }>(saved).id))
        .get();
      expect(JSON.parse(row?.roomScope ?? "[]")).toContain(APOLLO);
    });
  });

  test("an admin reads a shared agent's memories only about rooms they can see themselves", async () => {
    const olga = await listed(o.people.olga.cookie);
    expect(olga.status).toBe(200);
    expect(olga.body).toMatchObject({ entries: [], total: 0 });
    expect(olga.text).not.toMatch(/CANARY|apollo/i);
    const search = await listed(o.people.olga.cookie, "&q=APOLLOCANARY");
    expect(search.body.entries).toEqual([]);
    const notes = await o.send(`${P().entries}?kind=note`, "GET", o.people.olga.cookie);
    expect(await notes.text()).not.toMatch(/CANARY|Apollo plan/);
    // Changing or deleting it by id: the same answer as for an id that does not exist.
    for (const method of ["PATCH", "DELETE"] as const) {
      const body = method === "PATCH" ? { text: "overwritten" } : undefined;
      const closed = await o.send(P().entry(memoryId), method, o.people.olga.cookie, body);
      const missing = await o.send(P().entry("no-such-id"), method, o.people.olga.cookie, body);
      expect(closed.status).toBe(404);
      expect(await closed.text()).toBe(await missing.text());
    }
    expect(o.officeAgents.mind.entry(pm.id, memoryId).text).toBe(CANARY);

    // Ada sees both rooms: she reads it, with the rooms it is about.
    const ada = await listed(o.people.ada.cookie, "&q=APOLLOCANARY");
    expect(ada.body.entries).toMatchObject([{ id: memoryId, text: CANARY, rooms: [APOLLO] }]);
    // When her own access to Apollo goes, so does the entry, admin or not.
    o.setRoomAccess(APOLLO, o.people.ada.id, null);
    expect((await listed(o.people.ada.cookie, "&q=APOLLOCANARY")).body.entries).toEqual([]);
    o.setRoomAccess(APOLLO, o.people.ada.id, "manage");
  });

  test("an entry written by hand may name only rooms the writer can see", async () => {
    const write = (cookie: string, rooms: string[]) =>
      o.send(P().entries, "POST", cookie, { kind: "memory", text: "by hand", rooms });
    const refused = await write(o.people.olga.cookie, [APOLLO]);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toBe(
      await (await write(o.people.olga.cookie, ["op-no-such-room"])).text(),
    );
    const saved = await write(o.people.ada.cookie, [BOREALIS]);
    expect(saved.status).toBe(201);
    expect(await saved.json()).toMatchObject({ rooms: [BOREALIS] });
    expect((await listed(o.people.olga.cookie, "&q=hand")).body.entries).toEqual([]);
    // About no room: everyone who may read the agent's memories at all reads it.
    expect((await write(o.people.olga.cookie, [])).status).toBe(201);
    expect((await listed(o.people.olga.cookie, "&q=hand")).body.entries).toHaveLength(1);
  });

  test("memories from before the migration take the agent's grants as their scope", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, "0028_office_agent_room_limits.sql"), "utf8");
    const backfill = sql
      .split("--> statement-breakpoint")
      .find((s) => s.includes("json_group_array"));
    if (!backfill) throw new Error("no backfill statement");
    o.db
      .update(officeAgentMemories)
      .set({ roomScope: "[]" })
      .where(eq(officeAgentMemories.id, memoryId))
      .run();
    // Without a scope it would reach everyone.
    expect(o.officeAgents.mind.entry(pm.id, memoryId).rooms).toBeUndefined();
    o.db.$client.run(backfill);
    expect(o.officeAgents.mind.entry(pm.id, memoryId).rooms?.sort()).toEqual([APOLLO, BOREALIS]);
    // Run again it changes nothing.
    o.db.$client.run(backfill);
    expect(o.officeAgents.mind.entry(pm.id, memoryId).rooms?.sort()).toEqual([APOLLO, BOREALIS]);
  });
});
