/**
 * Migration 0017 (#186) renames pre-compound seat ids to generated ones so
 * every robot keeps its seat when the scene switches to generated rooms.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalSeatId,
  LEGACY_SEAT_IDS,
  legacyDeskCount,
  ROOM_LAYOUT_ID,
  roomDeskSeatIds,
} from "@regulus/floor-layout";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "./index.ts";
import { legacySeatMigrationSql, legacySeatStatements } from "./legacy-seats.ts";

const MIGRATIONS = join(import.meta.dir, "../../drizzle");
const FILE = join(MIGRATIONS, "0017_room_seats.sql");
const dir = mkdtempSync(join(tmpdir(), "rg-room-seats-migration-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The migrations folder as it was before `tag`. */
function before(tag: string): string {
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

describe("0017_room_seats", () => {
  test("the committed SQL is what the seat map generates", () => {
    const body = readFileSync(FILE, "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("-- "))
      .join("\n");
    expect(body).toBe(legacySeatMigrationSql());
    // One rename per table and template, the extra desk rows, then the template switch.
    expect(legacySeatStatements().length).toBeGreaterThanOrEqual(
      Object.keys(LEGACY_SEAT_IDS).length * 2 + 1,
    );
  });

  test("robots keep their seats; every generated seat has a desk row; floors become rooms", () => {
    const db = openDatabase({ path: MEMORY_DB_PATH });
    const sql = db.$client;
    sql.run("PRAGMA foreign_keys = OFF");
    runMigrations(db, before("room_seats"));
    const templates = [...Object.keys(LEGACY_SEAT_IDS), "custom", ROOM_LAYOUT_ID];
    templates.forEach((t, i) => {
      sql.run(
        "INSERT INTO floors (id, name, slug, `index`, palette_id, layout_template_id, desk_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'p', ?, ?, 0, 0)",
        [`f${i}`, t, `s${i}`, i + 1, t, legacyDeskCount(t) ?? 1],
      );
      // Desk rows as the floor service made them: one per template seat (or generated seat).
      const seats = Object.keys(LEGACY_SEAT_IDS[t] ?? {}).length
        ? Object.keys(LEGACY_SEAT_IDS[t] ?? {})
        : t === ROOM_LAYOUT_ID
          ? roomDeskSeatIds(1)
          : ["custom-seat"];
      for (const seat of seats)
        sql.run(
          "INSERT INTO desks (id, floor_id, seat_id, created_at, updated_at) VALUES (?, ?, ?, 0, 0)",
          [`k-${i}-${seat}`, `f${i}`, seat],
        );
      // A robot on the last seat of every floor.
      const seat = seats.at(-1) ?? "";
      sql.run(
        "INSERT INTO agents (id, floor_id, repo_id, desk_seat_id, owner_user_id, provider, model, profile_id, workdir, task_title, created_at, updated_at) VALUES (?, ?, 'r', ?, 'u', 'claude-code', 'opus', 'p', '/w', 't', 0, 0)",
        [`a${i}`, `f${i}`, seat],
      );
      sql.run("UPDATE desks SET agent_id = ? WHERE floor_id = ? AND seat_id = ?", [
        `a${i}`,
        `f${i}`,
        seat,
      ]);
    });
    sql.run("PRAGMA foreign_keys = ON");
    runMigrations(db);

    const floorsAfter = sql
      .query<{ id: string; layout_template_id: string }, []>(
        "SELECT id, layout_template_id FROM floors ORDER BY `index`",
      )
      .all();
    const desksOf = (floorId: string) =>
      sql
        .query<{ seat_id: string; agent_id: string | null }, [string]>(
          "SELECT seat_id, agent_id FROM desks WHERE floor_id = ? ORDER BY seat_id",
        )
        .all(floorId);
    const seatOf = (agentId: string) =>
      sql
        .query<{ desk_seat_id: string }, [string]>("SELECT desk_seat_id FROM agents WHERE id = ?")
        .get(agentId)?.desk_seat_id;

    Object.entries(LEGACY_SEAT_IDS).forEach(([t, map], i) => {
      expect(floorsAfter[i]?.layout_template_id).toBe(ROOM_LAYOUT_ID);
      const rows = desksOf(`f${i}`);
      // Exactly the generated seats of the floor's desks, with the robot still on its seat.
      expect(rows.map((r) => r.seat_id)).toEqual(
        [...roomDeskSeatIds(legacyDeskCount(t) ?? 1)].sort(),
      );
      const oldSeat = Object.keys(map).at(-1) ?? "";
      const newSeat = canonicalSeatId(t, oldSeat);
      expect(seatOf(`a${i}`)).toBe(newSeat);
      expect(rows.find((r) => r.seat_id === newSeat)?.agent_id).toBe(`a${i}`);
      expect(rows.filter((r) => r.agent_id !== null)).toHaveLength(1);
    });
    // Floors on anything else are left alone.
    const custom = Object.keys(LEGACY_SEAT_IDS).length;
    expect(floorsAfter[custom]?.layout_template_id).toBe("custom");
    expect(desksOf(`f${custom}`).map((r) => r.seat_id)).toEqual(["custom-seat"]);
    expect(seatOf(`a${custom}`)).toBe("custom-seat");
    expect(floorsAfter[custom + 1]?.layout_template_id).toBe(ROOM_LAYOUT_ID);
    expect(desksOf(`f${custom + 1}`).map((r) => r.seat_id)).toEqual(roomDeskSeatIds(1).sort());
    sql.close();
  });
});
