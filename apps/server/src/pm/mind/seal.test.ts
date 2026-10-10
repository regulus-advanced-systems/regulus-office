/**
 * Souls, memories and notes are encrypted in the database (#301): nothing of
 * them is in a row, or in the database file a backup copies; search and
 * titles still work; a row does not open under another key, on another
 * agent, or in another row or column. (Rows from before: seal-existing.test.ts.)
 */
import { describe, expect, test } from "bun:test";
import { OFFICE_AGENTS_API_PATH, type OfficeAgentView } from "@regulus/protocol";
import { testKeyring } from "../../notifications/testing.ts";
import { agentsOffice } from "../test-helpers.ts";
import { AgentMind, MindError } from "./mind.ts";
import {
  CANARIES,
  fill,
  MEMORY,
  NOTE,
  office,
  onDisk,
  open,
  rows,
  SOUL,
  SOURCE,
  TITLE,
} from "./seal.fixture.ts";
import { MindCipher, PLAIN } from "./seal.ts";
import { countUnsealed, sealExisting } from "./seal-existing.ts";
import { MindStore } from "./store.ts";

describe("with OFFICE_MASTER_KEY", () => {
  test("no row and no byte of the database file holds the text; the office reads it as before", () => {
    const o = office(new MindCipher(testKeyring()));
    const { agent, memory } = fill(o);
    const stored = rows(o.db);
    const disk = onDisk(o.db, o.file);
    for (const canary of CANARIES) {
      expect(stored).not.toContain(canary);
      expect(disk).not.toContain(canary);
    }
    expect(countUnsealed(o.db)).toEqual({ souls: 0, versions: 0, entries: 0 });
    const flags = o.db.$client
      .query(
        "select kind, sealed, title, title_key, source, room_scope from office_agent_memories order by kind",
      )
      .all();
    // The rooms an entry is about are ids, not text: they stay readable (the filter needs them).
    expect(flags).toEqual([
      { kind: "memory", sealed: 1, title: "", title_key: "", source: "", room_scope: '["op-1"]' },
      { kind: "note", sealed: 1, title: "", title_key: "", source: "", room_scope: "[]" },
    ]);

    expect(o.store.get(agent.id)?.instructions).toBe(`${SOUL} v2`);
    expect(o.store.list()[0]?.instructions).toBe(`${SOUL} v2`);
    expect(o.mind.soul(agent.id)).toMatchObject({ version: 2, content: `${SOUL} v2` });
    expect(o.mind.version(agent.id, 1).content).toBe(SOUL);
    expect(o.mind.versions(agent.id).map((v) => v.chars)).toEqual([SOUL.length + 3, SOUL.length]);
    expect(o.mind.entry(agent.id, memory.id)).toMatchObject({
      text: MEMORY,
      source: SOURCE,
      rooms: ["op-1"],
    });
  });

  test("search and titles still work: the agent's entries are opened and matched in memory", () => {
    const o = office(new MindCipher(testKeyring()));
    const { agent } = fill(o);
    // Sorted: entries saved in the same millisecond have no order of their own.
    const texts = (query: string) =>
      o.mind
        .search(agent.id, query)
        .map((e) => e.text)
        .sort();
    expect(texts("launch friday")).toEqual([MEMORY]);
    // By a word of the source, and of a note's title.
    expect(texts("sourcecanary")).toEqual([MEMORY]);
    expect(texts("titlecanary plan")).toEqual([NOTE]);
    expect(texts("launch")).toEqual([MEMORY, NOTE]);
    expect(texts("nothing-like-this")).toEqual([]);
    expect(o.mind.list(agent.id, "memory", { query: "FRIDAY" }).entries).toHaveLength(1);
    // A note is found by its title whatever the case and spacing, and stays one note.
    expect(o.mind.note(agent.id, "  titlecanary   LAUNCH plan ").text).toBe(NOTE);
    const again = o.mind.writeNote(
      agent.id,
      { title: "titlecanary launch plan", text: "more", append: true },
      "agent",
    );
    expect(again).toMatchObject({ created: false, entry: { text: `${NOTE}\nmore` } });
    expect(o.mind.list(agent.id, "note").total).toBe(1);
    expect(rows(o.db)).not.toContain("NOTECANARY");
  });

  test("an empty document stays empty: there is nothing in it to protect", () => {
    const o = office(new MindCipher(testKeyring()));
    const agent = o.store.insert(o.db, {
      name: "Blank",
      ownerUserId: null,
      engine: "cli-session",
      role: "assistant",
      preset: "observer",
      provider: "claude-code",
      model: "sonnet",
      instructions: "",
    });
    expect(o.store.get(agent.id)?.instructions).toBe("");
    expect(o.mind.soul(agent.id)).toMatchObject({ version: 0, content: "" });
    expect(sealExisting(o.db, new MindCipher(testKeyring()))).toEqual({
      souls: 0,
      versions: 0,
      entries: 0,
    });
  });

  test("a row opens only under its key and on its agent", () => {
    const o = office(new MindCipher(testKeyring()));
    const { agent, memory } = fill(o);
    // Another key (the wrong OFFICE_MASTER_KEY, or none): a refusal with fixed words, no text.
    for (const cipher of [new MindCipher(testKeyring()), PLAIN]) {
      const mind = new AgentMind(new MindStore(o.db, Date.now, cipher));
      for (const read of [
        () => mind.soul(agent.id),
        () => mind.entry(agent.id, memory.id),
        () => mind.search(agent.id, "launch"),
        () => mind.versions(agent.id),
      ]) {
        let thrown: unknown;
        try {
          read();
        } catch (err) {
          thrown = err;
        }
        expect(thrown).toBeInstanceOf(MindError);
        expect((thrown as MindError).code).toBe("unreadable");
        for (const canary of CANARIES) expect((thrown as Error).message).not.toContain(canary);
      }
    }
    // An envelope copied onto another agent's row does not open there.
    const other = o.store.insert(o.db, {
      name: "Other",
      ownerUserId: null,
      engine: "cli-session",
      role: "assistant",
      preset: "observer",
      provider: "claude-code",
      model: "sonnet",
      instructions: "mine",
    });
    o.db.$client.run(
      `update office_agents set instructions = (select instructions from office_agents where id = '${agent.id}') where id = '${other.id}'`,
    );
    expect(() => o.mind.soul(other.id)).toThrow(MindError);
    expect(o.mind.soul(agent.id).content).toBe(`${SOUL} v2`);
  });

  test("an envelope opens only in its own row and column, also within one agent", () => {
    const o = office(new MindCipher(testKeyring()));
    const { agent, memory } = fill(o);
    // A memory about one room, and one that reaches everyone, of the same agent.
    const open = o.mind.addMemory(agent.id, { text: "harmless" }, "agent", []);
    const raw = o.db.$client
      .query("select text from office_agent_memories where id = ?")
      .get(memory.id) as { text: string };
    // Copied onto the row that reaches everyone: it does not open there.
    o.db.$client
      .prepare("update office_agent_memories set text = ? where id = ?")
      .run(raw.text, open.id);
    expect(() => o.mind.entry(agent.id, open.id)).toThrow(MindError);
    expect(o.mind.entry(agent.id, memory.id).text).toBe(MEMORY);
    // Copied into the agent's document, or one of its versions: not there either.
    o.db.$client
      .prepare("update office_agents set instructions = ?, instructions_sealed = 1 where id = ?")
      .run(raw.text, agent.id);
    o.db.$client
      .prepare(
        "update office_agent_soul_versions set content = ? where agent_id = ? and version = 1",
      )
      .run(raw.text, agent.id);
    expect(o.store.get(agent.id)?.instructions).toBe("");
    expect(o.store.soulUnreadable(agent.id)).toBe(true);
    expect(() => o.mind.soul(agent.id)).toThrow(MindError);
    expect(() => o.mind.version(agent.id, 1)).toThrow(MindError);
    // A version's envelope does not open as the current document either.
    const v2 = o.db.$client
      .query("select content from office_agent_soul_versions where agent_id = ? and version = 2")
      .get(agent.id) as { content: string };
    o.db.$client
      .prepare("update office_agents set instructions = ? where id = ?")
      .run(v2.content, agent.id);
    expect(o.store.soulUnreadable(agent.id)).toBe(true);
    expect(o.mind.version(agent.id, 2).content).toBe(`${SOUL} v2`);
  });
});

describe("a document that cannot be decrypted, over the office", () => {
  test("the agent still lists and can be removed; it is not read and not started with an empty document", async () => {
    const o = await agentsOffice();
    try {
      const A = OFFICE_AGENTS_API_PATH;
      const { mia } = o.people;
      const make = async (name: string) =>
        (await (
          await o.send(A, "POST", mia.cookie, {
            name,
            owner: "me",
            engine: "cli-session",
            role: "assistant",
            provider: "claude-code",
            model: "sonnet",
            instructions: `${SOUL} (${name})`,
          })
        ).json()) as OfficeAgentView;
      const one = await make("One");
      const two = await make("Two");
      // As after a restore with the wrong key: One's row holds an envelope that does not open for it.
      o.db.$client.run(
        `update office_agents set instructions = (select instructions from office_agents where id = '${two.id}') where id = '${one.id}'`,
      );
      const list = await o.send(A, "GET", mia.cookie);
      expect(list.status).toBe(200);
      const card = ((await list.json()) as { agents: OfficeAgentView[] }).agents.find(
        (a) => a.id === one.id,
      );
      expect(card?.config?.instructions).toBe("");
      const soul = await o.send(`${A}/${one.id}/soul`, "GET", mia.cookie);
      expect(soul.status).toBe(503);
      const said = await soul.text();
      expect(said).toContain("unreadable");
      expect(said).not.toContain("SOULCANARY");
      const start = await o.send(`${A}/${one.id}/start`, "POST", mia.cookie);
      expect(start.status).toBe(409);
      expect(((await start.json()) as { error: string }).error).toBe("unreadable");
      expect(o.fake.started.has(one.id)).toBe(false);
      // The other agent is untouched, and the broken one can be removed.
      expect((await o.send(`${A}/${two.id}/start`, "POST", mia.cookie)).status).toBe(200);
      expect((await o.send(`${A}/${one.id}`, "DELETE", mia.cookie)).status).toBe(204);
    } finally {
      await o.stop();
    }
  });
});
