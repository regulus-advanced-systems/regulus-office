/**
 * Rows from before encryption (#301): the office's start encrypts them, the
 * step can run again, and the rebuild of the file that drops the old plain
 * text is owed until it has really happened.
 */
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { closeDatabase, type Db } from "../../db/index.ts";
import { testKeyring } from "../../notifications/testing.ts";
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
import { countUnsealed, scrubPending, sealExisting } from "./seal-existing.ts";

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

  test("a start that is killed before the file was rebuilt is finished by the next one", () => {
    const before = office(PLAIN);
    fill(before);
    for (let i = 0; i < 40; i++) {
      before.mind.addMemory(
        before.store.list()[0]?.id ?? "",
        {
          text: `MEMORYCANARY ${i} ${"x".repeat(400)}`,
        },
        "agent",
      );
    }
    const cipher = new MindCipher(testKeyring());
    // The office is killed (a deploy's health check, the OOM killer) after the rows were sealed
    // and before the rebuild: stood in for by a VACUUM that fails once.
    const client = before.db.$client as unknown as {
      run(sql: string, ...rest: unknown[]): unknown;
    };
    const run = client.run.bind(client);
    client.run = (sql, ...rest) => {
      if (sql === "VACUUM") throw new Error("killed");
      return run(sql, ...rest);
    };
    const first = sealExisting(before.db, cipher);
    client.run = run;
    expect(first).toMatchObject({ souls: 1, versions: 2, entries: 42, scrubbed: false });
    // The rows are sealed, the file is not clean yet, and the office knows it still owes that.
    expect(rows(before.db)).not.toContain("MEMORYCANARY");
    expect(onDisk(before.db, before.file)).toContain("MEMORYCANARY");
    expect(scrubPending(before.db)).toBe(true);

    // The next start has nothing left to seal, and rebuilds the file.
    expect(sealExisting(before.db, cipher)).toEqual({
      souls: 0,
      versions: 0,
      entries: 0,
      scrubbed: true,
    });
    expect(scrubPending(before.db)).toBe(false);
    const disk = onDisk(before.db, before.file);
    for (const canary of CANARIES) expect(disk).not.toContain(canary);
    // And then there is nothing more to do.
    expect(sealExisting(before.db, cipher)).toEqual({ souls: 0, versions: 0, entries: 0 });
  });

  test("with another connection reading, the WAL cannot be emptied: not reported as done, and tried again", () => {
    // (A short wait for the lock, so the test does not sit out the office's five seconds.)
    const before = office(PLAIN, undefined, 200);
    fill(before);
    const other = new Database(before.file);
    other.run("BEGIN");
    other.query("select count(*) from office_agents").get();
    const cipher = new MindCipher(testKeyring());
    const first = sealExisting(before.db, cipher);
    // The plain text is still in the files beside the database, and the step says so.
    expect(first.scrubbed).toBe(false);
    expect(scrubPending(before.db)).toBe(true);
    other.run("COMMIT");
    other.close();
    expect(sealExisting(before.db, cipher)).toEqual({
      souls: 0,
      versions: 0,
      entries: 0,
      scrubbed: true,
    });
    const disk = onDisk(before.db, before.file);
    for (const canary of CANARIES) expect(disk).not.toContain(canary);
  });

  test("without a key nothing is encrypted, and the office can say how much is plain", () => {
    const o = office(PLAIN);
    fill(o);
    expect(sealExisting(o.db, PLAIN)).toEqual({ souls: 0, versions: 0, entries: 0 });
    expect(countUnsealed(o.db)).toEqual({ souls: 1, versions: 2, entries: 2 });
    expect(rows(o.db)).toContain("SOULCANARY");
  });
});
