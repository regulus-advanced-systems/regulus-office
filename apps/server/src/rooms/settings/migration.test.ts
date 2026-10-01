/**
 * The room settings migration (#182) on a database from before it: operations
 * on a fixed template get enough desks for every old desk seat, so henchmen
 * keep their seats, and their seat ids are left untouched. The database stays
 * before 0018 (#226), so the SQL here uses the table names of the time
 * (`floors`, `floor_id`).
 */
import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSeatId, legacyDeskCount, roomDeskSeatIds } from "@regulus/room-layout";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "../../db/index.ts";

const MIGRATIONS = join(import.meta.dir, "../../../drizzle");
const TAG = "room_settings";
const dir = mkdtempSync(join(tmpdir(), "rg-room-settings-migration-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The migrations folder as it was before `tag` (this one by default). */
function before(tag = TAG): string {
  const old = join(dir, `drizzle-${tag}`);
  cpSync(MIGRATIONS, old, { recursive: true });
  const journalPath = join(old, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  const at = journal.entries.findIndex((e) => e.tag.endsWith(tag));
  expect(at).toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, at);
  writeFileSync(journalPath, JSON.stringify(journal));
  return old;
}

test("migrated operations get desks for every template seat; seat ids stay", () => {
  const db = openDatabase({ path: MEMORY_DB_PATH });
  const sql = db.$client;
  sql.run("PRAGMA foreign_keys = OFF");
  runMigrations(db, before());
  const templates = ["office-small", "office-l2", "office-large", "custom"];
  templates.forEach((t, i) => {
    sql.run(
      "INSERT INTO floors (id, name, slug, `index`, palette_id, layout_template_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'p', ?, 0, 0)",
      [`f${i}`, t, `s${i}`, i + 1, t],
    );
  });
  sql.run(
    "INSERT INTO desks (id, floor_id, seat_id, created_at, updated_at) VALUES ('k1', 'f0', 'ceo-seat', 0, 0)",
  );
  sql.run("PRAGMA foreign_keys = ON");
  // Up to, not including, 0017, which renames the seats (#186; db/legacy-seats.test.ts).
  runMigrations(db, before("room_seats"));

  const rows = sql
    .query<{ layout_template_id: string; desk_count: number; decor_style: string }, []>(
      "SELECT layout_template_id, desk_count, decor_style FROM floors ORDER BY `index`",
    )
    .all();
  expect(rows.map((r) => [r.layout_template_id, r.desk_count, r.decor_style])).toEqual([
    ["office-small", 2, "ops_room"],
    ["office-l2", 3, "ops_room"],
    ["office-large", 5, "ops_room"],
    ["custom", 1, "ops_room"],
  ]);
  for (const t of templates.slice(0, 3))
    expect(rows.find((r) => r.layout_template_id === t)?.desk_count).toBe(legacyDeskCount(t));
  const seat = sql
    .query<{ seat_id: string }, []>("SELECT seat_id FROM desks WHERE floor_id = 'f0'")
    .get();
  expect(seat?.seat_id).toBe("ceo-seat");
  expect(roomDeskSeatIds(2)).toContain(canonicalSeatId("office-small", "ceo-seat"));
  sql.close();
});
