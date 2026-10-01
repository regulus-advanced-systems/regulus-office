/**
 * The room settings migration (#182) on a database from before it: floors
 * on a fixed template get enough desks for every old desk seat, so robots
 * keep their seats, and their seat ids are left untouched.
 */
import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSeatId, legacyDeskCount, roomDeskSeatIds } from "@regulus/room-layout";
import { asc, eq } from "drizzle-orm";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "../../db/index.ts";
import { desks, floors } from "../../db/schema/index.ts";

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

test("migrated floors get desks for every template seat; seat ids stay", () => {
  const db = openDatabase({ path: MEMORY_DB_PATH });
  db.$client.run("PRAGMA foreign_keys = OFF");
  runMigrations(db, before());
  const templates = ["office-small", "office-l2", "office-large", "custom"];
  templates.forEach((t, i) => {
    db.$client.run(
      "INSERT INTO floors (id, name, slug, `index`, palette_id, layout_template_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'p', ?, 0, 0)",
      [`f${i}`, t, `s${i}`, i + 1, t],
    );
  });
  db.$client.run(
    "INSERT INTO desks (id, floor_id, seat_id, created_at, updated_at) VALUES ('k1', 'f0', 'ceo-seat', 0, 0)",
  );
  db.$client.run("PRAGMA foreign_keys = ON");
  // Up to, not including, 0017, which renames the seats (#186; db/legacy-seats.test.ts).
  runMigrations(db, before("room_seats"));

  const rows = db.select().from(floors).orderBy(asc(floors.index)).all();
  expect(rows.map((r) => [r.layoutTemplateId, r.deskCount, r.decorStyle])).toEqual([
    ["office-small", 2, "ops_room"],
    ["office-l2", 3, "ops_room"],
    ["office-large", 5, "ops_room"],
    ["custom", 1, "ops_room"],
  ]);
  for (const t of templates.slice(0, 3))
    expect(rows.find((r) => r.layoutTemplateId === t)?.deskCount).toBe(legacyDeskCount(t));
  const seat = db.select().from(desks).where(eq(desks.floorId, "f0")).get();
  expect(seat?.seatId).toBe("ceo-seat");
  expect(roomDeskSeatIds(2)).toContain(canonicalSeatId("office-small", "ceo-seat"));
  db.$client.close();
});
