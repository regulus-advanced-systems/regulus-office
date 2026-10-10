/**
 * The hard case of #301: a memory a shared agent wrote while helping one
 * person about a room does not surface for a person who cannot see that room,
 * neither in a later chat with the same agent nor for an admin reading its
 * memories in Settings. How a memory carries its rooms: the office stamps it
 * with the rooms the conversation it was written in had read (pm/scope.ts);
 * the agent declares nothing. An entry closed to someone leaves no trace for
 * them: not its title, not its place under the cap. Entries whose rooms are
 * not known (from before the upgrade) are closed to everyone. Who is who is in asker-limits.fixture.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type MindEntriesResponse,
  OFFICE_AGENT_MIND_LIMITS,
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

  test("a note they cannot see does not take its title: writing it is like writing any new note", async () => {
    const P = officeAgentMindPaths(pm.id);
    await during(o.people.sam, async () => {
      // His conversation has looked at Borealis, so what he has it write is about Borealis.
      expect((await call("read_board", { operationId: BOREALIS })).status).toBe(200);
      const same = await call("note_write", { title: "apollo  PLAN", text: "Sam's own plan" });
      const free = await call("note_write", { title: "Some free title", text: "Sam's own plan" });
      // Nothing tells the two apart: not the status, not the words.
      expect(same.status).toBe(200);
      expect(resultOf<{ created: boolean }>(same).created).toBe(true);
      expect(Object.keys(same.body).sort()).toEqual(Object.keys(free.body).sort());
      expect(
        resultOf<{ text: string }>(await call("note_read", { title: "Apollo plan" })).text,
      ).toBe("Sam's own plan");
      await call("note_delete", { title: "Some free title" });
    });
    // Mia's note is as it was, and for her it is the one with that title.
    await during(o.people.mia, async () => {
      expect(
        resultOf<{ text: string }>(await call("note_read", { title: "Apollo plan" })).text,
      ).toBe(`Plan: ${CANARY}`);
    });
    // In Settings the same: the owner, who sees neither room, adds a note with that title like any other...
    const add = (title: string) =>
      o.send(P.entries, "POST", o.people.olga.cookie, { kind: "note", title, text: "x" });
    const hidden = await add("Apollo plan");
    const fresh = await add("Another title");
    expect([hidden.status, fresh.status]).toEqual([201, 201]);
    // ...and is told so only about a note she can see herself.
    const again = await add("Apollo plan");
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("title_taken");
    // Put back: only Mia's note keeps the title.
    for (const note of o.officeAgents.mind.list(pm.id, "note", { limit: 1000 }).entries) {
      if (note.text !== `Plan: ${CANARY}`) o.officeAgents.mind.remove(pm.id, note.id);
    }
  });

  test("a note with the same title that everyone can see does not stand in for one's own", async () => {
    const read = async () =>
      resultOf<{ text: string }>(await call("note_read", { title: "Apollo plan" })).text;
    // Olga's conversation has looked at no room, so the "Apollo plan" she has the agent write is
    // about no room: everyone who talks to the agent can see it, Mia included. It is the newest.
    await during(o.people.olga, async () => {
      const written = await call("note_write", { title: "Apollo plan", text: "Olga's plan" });
      expect(resultOf<{ created: boolean }>(written).created).toBe(true);
    });
    // For Mia the title still means the note her own conversation wrote...
    await during(o.people.mia, async () => {
      expect(await read()).toBe(`Plan: ${CANARY}`);
      // ...and adding to it adds to hers, not to Olga's.
      await call("note_write", { title: "Apollo plan", text: "more", append: true });
      expect(await read()).toBe(`Plan: ${CANARY}\nmore`);
    });
    // For Olga it means hers (she cannot see Mia's at all).
    await during(o.people.olga, async () => {
      expect(await read()).toBe("Olga's plan");
    });
    // Ada wrote neither and can see both: she gets the one about more rooms, which fewer people
    // share, not the newest.
    await during(o.people.ada, async () => {
      expect(await read()).toBe(`Plan: ${CANARY}\nmore`);
    });
    // Sam can see only Olga's.
    await during(o.people.sam, async () => {
      expect(await read()).toBe("Olga's plan");
    });
    // Put back.
    const { mind } = o.officeAgents;
    for (const note of mind.list(pm.id, "note", { limit: 1000 }).entries) {
      if (note.text === "Olga's plan") mind.remove(pm.id, note.id);
      else mind.update(pm.id, note.id, { text: `Plan: ${CANARY}` });
    }
  });

  test("the caps count what the writer can see; entries closed to them do not show through", async () => {
    const { memoriesMax } = OFFICE_AGENT_MIND_LIMITS;
    const { mind } = o.officeAgents;
    const added: string[] = [];
    // Straight into the store, as a writer who sees none of the others would add them.
    const fill = (n: number) => {
      for (let i = 0; i < n; i++) {
        const entry = mind.addMemory(
          pm.id,
          { text: `filler ${i}` },
          "agent",
          [APOLLO],
          () => false,
        );
        added.push(entry.id);
      }
    };
    const rows = () =>
      (
        o.db.$client
          .query(
            "select count(*) as n from office_agent_memories where agent_id = ? and kind = 'memory'",
          )
          .get(pm.id) as { n: number }
      ).n;
    // As many memories about Apollo as an agent may have.
    const miaSees = mind
      .list(pm.id, "memory", { limit: 1000 })
      .entries.filter((e) => (e.rooms ?? []).every((room) => room === APOLLO)).length;
    fill(memoriesMax - miaSees);
    await during(o.people.mia, async () => {
      const full = await call("memory_save", { text: "one too many" });
      expect([full.status, full.body]).toMatchObject([429, { error: "cap_reached" }]);
    });
    // Sam sees none of them: for him the store is as empty as it looks.
    await during(o.people.sam, async () => {
      const saved = await call("memory_save", { text: "Sam's first" });
      expect(saved.status).toBe(200);
      added.push(resultOf<{ id: string }>(saved).id);
      const list = resultOf<{ total: number }>(await call("memory_list"));
      expect(list.total).toBeLessThan(10);
    });
    // Behind that, the table is bounded: past the hard cap a save fails like any failure of the
    // office, with no word about memories or caps.
    fill(memoriesMax * 4 - rows());
    await during(o.people.sam, async () => {
      const failed = await call("memory_save", { text: "past the hard cap" });
      expect([failed.status, failed.body]).toEqual([
        500,
        { ok: false, error: "failed", message: "the office could not do that" },
      ]);
    });
    for (const id of added) mind.remove(pm.id, id);
  }, 60_000);

  test("after the upgrade a shared agent starts with none of its earlier memories: their rooms are unknown", async () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, "0028_office_agent_room_limits.sql"), "utf8");
    const statement = sql
      .split("--> statement-breakpoint")
      .find((part) => part.includes("'unknown'"));
    if (!statement) throw new Error("no statement for earlier entries");
    const { mind } = o.officeAgents;
    const rows = () =>
      (
        o.db.$client
          .query("select count(*) as n from office_agent_memories where agent_id = ?")
          .get(pm.id) as { n: number }
      ).n;
    // As before the upgrade: entries with no scope, which would reach everyone; and the agent
    // has no grant left, so nothing says which rooms they were about.
    const kept = rows();
    o.db.update(officeAgentMemories).set({ roomScope: "[]" }).run();
    expect(mind.entry(pm.id, memoryId).rooms).toBeUndefined();
    const grants = o.officeAgents.store.grants(pm.id);
    o.officeAgents.store.setGrants(pm.id, []);
    o.db.$client.run(statement);
    o.officeAgents.store.setGrants(pm.id, grants);

    // Shown to nobody, whatever they can see: in Settings, to the agent, to its engine.
    const P = officeAgentMindPaths(pm.id);
    for (const person of [o.people.ada, o.people.olga]) {
      for (const kind of ["memory", "note"]) {
        const res = await o.send(`${P.entries}?kind=${kind}`, "GET", person.cookie);
        const text = await res.text();
        expect(JSON.parse(text)).toMatchObject({ entries: [], total: 0 });
        expect(text).not.toMatch(/CANARY|Apollo plan/);
      }
      expect((await o.send(P.entry(memoryId), "DELETE", person.cookie)).status).toBe(404);
    }
    await during(o.people.ada, async () => {
      expect(resultOf<{ total: number }>(await call("memory_list")).total).toBe(0);
      expect(
        resultOf<{ memories: unknown[]; notes: unknown[] }>(
          await call("memory_search", { query: "APOLLOCANARY" }),
        ),
      ).toEqual({ memories: [], notes: [] });
      expect((await call("note_read", { title: "Apollo plan" })).status).toBe(404);
      expect((await call("memory_forget", { id: memoryId })).status).toBe(404);
    });
    expect(digestFor(o.people.ada.id)).toBe("");
    expect(digestFor()).toBe("");
    expect(mind.list(pm.id, "memory", { limit: 1000 }).total).toBe(0);
    // Nothing was destroyed: the rows are still there, encrypted.
    expect(rows()).toBe(kept);
    // Run again it changes nothing.
    o.db.$client.run(statement);
    expect(rows()).toBe(kept);
  });

  test("a room scope that cannot be read closes the entry too", async () => {
    const entry = o.officeAgents.mind.addMemory(pm.id, { text: "scoped" }, "agent", [APOLLO]);
    for (const broken of ['{"rooms":["op-apollo"]}', "", "null", "[1]", '"[]"']) {
      o.db
        .update(officeAgentMemories)
        .set({ roomScope: broken })
        .where(eq(officeAgentMemories.id, entry.id))
        .run();
      expect(() => o.officeAgents.mind.entry(pm.id, entry.id)).toThrow("no such memory or note");
      const olga = await o.send(
        `${officeAgentMindPaths(pm.id).entries}?kind=memory`,
        "GET",
        o.people.olga.cookie,
      );
      expect(((await olga.json()) as MindEntriesResponse).entries).toEqual([]);
    }
  });
});
