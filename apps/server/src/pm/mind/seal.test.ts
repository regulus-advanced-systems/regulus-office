/**
 * Souls, memories and notes are encrypted in the database (#301): nothing of
 * them is in a row, or in the database file a backup copies; rows written
 * before are encrypted by the office's start, and that step can run again;
 * search and titles still work; a row does not open under another key or on
 * another agent.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OFFICE_AGENTS_API_PATH, type OfficeAgentView } from "@regulus/protocol";
import {
  closeDatabase,
  type Db,
  databasePathFor,
  openDatabase,
  runMigrations,
} from "../../db/index.ts";
import { testKeyring } from "../../notifications/testing.ts";
import { OfficeAgentStore } from "../store.ts";
import { agentsOffice } from "../test-helpers.ts";
import { AgentMind, MindError } from "./mind.ts";
import { MindCipher, PLAIN } from "./seal.ts";
import { countUnsealed, sealExisting } from "./seal-existing.ts";
import { MindStore } from "./store.ts";

const SOUL = "You are Ledger. SOULCANARY: be blunt.";
const MEMORY = "MEMORYCANARY the launch is on Friday";
const SOURCE = "SOURCECANARY Mia, in chat";
const TITLE = "TITLECANARY Launch plan";
const NOTE = "NOTECANARY step one, step two";
const CANARIES = ["SOULCANARY", "MEMORYCANARY", "SOURCECANARY", "TITLECANARY", "NOTECANARY"];

const dirs: string[] = [];
const open: Db[] = [];
afterEach(() => {
  for (const db of open.splice(0)) closeDatabase(db);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function office(cipher: MindCipher, path?: string) {
  let file = path;
  if (!file) {
    const dir = mkdtempSync(join(tmpdir(), "rgo-seal-"));
    dirs.push(dir);
    file = databasePathFor(dir);
  }
  const db = openDatabase({ path: file });
  open.push(db);
  runMigrations(db);
  const store = new OfficeAgentStore(db, Date.now, cipher);
  const mind = new AgentMind(new MindStore(db, Date.now, cipher));
  return { db, file, store, mind };
}

function fill({ store, mind }: Pick<ReturnType<typeof office>, "store" | "mind">) {
  const agent = store.insert(store.db, {
    name: "Ledger",
    ownerUserId: null,
    engine: "cli-session",
    role: "pm",
    preset: "coordinator",
    provider: "claude-code",
    model: "sonnet",
    instructions: SOUL,
  });
  mind.saveSoul(agent.id, SOUL, { userId: null, kind: "created" });
  mind.saveSoul(agent.id, `${SOUL} v2`, { userId: null, kind: "edit" });
  const memory = mind.addMemory(agent.id, { text: MEMORY, source: SOURCE }, "agent", ["op-1"]);
  mind.writeNote(agent.id, { title: TITLE, text: NOTE }, "agent");
  return { agent, memory };
}

/** Every table that holds an agent's text, as the rows are. */
const rows = (db: Db) =>
  JSON.stringify(
    ["office_agents", "office_agent_soul_versions", "office_agent_memories"].map((table) =>
      db.$client.query(`select * from ${table}`).all(),
    ),
  );

/** The database as a backup would copy it: the file and whatever sits beside it (the WAL). */
function onDisk(db: Db, file: string): string {
  db.$client.run("PRAGMA wal_checkpoint(TRUNCATE)");
  const dir = join(file, "..");
  return readdirSync(dir)
    .map((name) => readFileSync(join(dir, name)).toString("latin1"))
    .join("\n");
}

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
});

describe("rows from before: the data step of migration 0028", () => {
  test("it encrypts what is plain, leaves no plain text in the file, and can run again", () => {
    // An office as it was: no encryption of these tables.
    const before = office(PLAIN);
    const { agent, memory } = fill(before);
    expect(rows(before.db)).toContain("MEMORYCANARY");
    expect(onDisk(before.db, before.file)).toContain("SOULCANARY");
    expect(countUnsealed(before.db)).toEqual({ souls: 1, versions: 2, entries: 2 });
    const stamps = () =>
      JSON.stringify(
        ["office_agents", "office_agent_soul_versions", "office_agent_memories"].map((table) =>
          before.db.$client.query(`select id, created_at, updated_at from ${table}`).all(),
        ),
      );
    const stampsBefore = stamps();

    const cipher = new MindCipher(testKeyring());
    expect(sealExisting(before.db, cipher)).toEqual({
      souls: 1,
      versions: 2,
      entries: 2,
      scrubbed: true,
    });
    const sealed = rows(before.db);
    const disk = onDisk(before.db, before.file);
    for (const canary of CANARIES) {
      expect(sealed).not.toContain(canary);
      // Not in free pages or the WAL either: the file was rebuilt.
      expect(disk).not.toContain(canary);
    }
    // Nothing about the rows changed but the text's form.
    expect(stamps()).toBe(stampsBefore);

    // Again, and after a restart: nothing left to do, and nothing is touched.
    expect(sealExisting(before.db, cipher)).toEqual({ souls: 0, versions: 0, entries: 0 });
    expect(rows(before.db)).toBe(sealed);
    closeDatabase(open.splice(open.indexOf(before.db), 1)[0] as Db);
    const after = office(cipher, before.file);
    expect(sealExisting(after.db, cipher)).toEqual({ souls: 0, versions: 0, entries: 0 });
    expect(rows(after.db)).toBe(sealed);

    // The office reads everything as it was written.
    expect(after.store.get(agent.id)?.instructions).toBe(`${SOUL} v2`);
    expect(after.mind.version(agent.id, 1).content).toBe(SOUL);
    expect(after.mind.entry(agent.id, memory.id)).toMatchObject({ text: MEMORY, source: SOURCE });
    expect(after.mind.note(agent.id, TITLE).text).toBe(NOTE);
    expect(
      after.mind
        .search(agent.id, "launch")
        .map((e) => e.text)
        .sort(),
    ).toEqual([MEMORY, NOTE]);
  });

  test("without a key nothing is encrypted, and the office can say how much is plain", () => {
    const o = office(PLAIN);
    fill(o);
    expect(sealExisting(o.db, PLAIN)).toEqual({ souls: 0, versions: 0, entries: 0 });
    expect(countUnsealed(o.db)).toEqual({ souls: 1, versions: 2, entries: 2 });
    expect(rows(o.db)).toContain("SOULCANARY");
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
