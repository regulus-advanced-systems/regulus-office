/**
 * The genius-avatar migration (#185): profiles from before it become the
 * default archetype, keep their henchman colour as the outfit where one maps,
 * and have not chosen yet, so the picker shows once.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_GENIUS_LOOK } from "@regulus/protocol";
import { getProfileByUserId } from "../auth/roles.ts";
import { MEMORY_DB_PATH, MIGRATIONS_DIR, openDatabase, runMigrations } from "../db/index.ts";

const TAG = "genius_avatar";
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the migrations folder that stops just before the genius-avatar migration. */
function migrationsBefore(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "office-migrations-"));
  dirs.push(dir);
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const at = journal.entries.findIndex((e) => e.tag.endsWith(tag));
  if (at < 0) throw new Error(`migration ${tag} not found`);
  journal.entries = journal.entries.slice(0, at);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe("genius avatar migration", () => {
  test("existing avatars become the default archetype; nobody has chosen yet", () => {
    const db = openDatabase({ path: MEMORY_DB_PATH });
    runMigrations(db, migrationsBefore(TAG));
    const now = Date.now();
    const insert = db.$client.prepare(
      `insert into users (id, name, email, email_verified, created_at, updated_at)
       values (?, ?, ?, 0, ?, ?)`,
    );
    const profile = db.$client.prepare(
      `insert into user_profiles (id, user_id, display_name, role, avatar_color_set,
         avatar_accessory, created_at, updated_at) values (?, ?, ?, 'member', ?, ?, ?, ?)`,
    );
    for (const [id, colorSet] of [
      ["u-oak", "oak"],
      ["u-cream", "cream"],
      ["u-default", "default"],
    ] as const) {
      insert.run(id, id, `${id}@example.com`, now, now);
      profile.run(`p-${id}`, id, id, colorSet, "antenna", now, now);
    }

    runMigrations(db);

    const oak = getProfileByUserId(db, "u-oak");
    expect(oak?.avatar).toEqual({ ...DEFAULT_GENIUS_LOOK, outfit: "mustard" });
    expect(oak?.avatarChosen).toBe(false);
    expect(getProfileByUserId(db, "u-cream")?.avatar.outfit).toBe("ivory");
    expect(getProfileByUserId(db, "u-default")?.avatar).toEqual(DEFAULT_GENIUS_LOOK);
    const columns = db.$client
      .query("select name from pragma_table_info('user_profiles')")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(columns).toContain("avatar");
    expect(columns).not.toContain("avatar_color_set");
    db.$client.close();
  });

  test("a corrupt stored avatar falls back to the default genius", () => {
    const db = openDatabase({ path: MEMORY_DB_PATH });
    runMigrations(db);
    const now = Date.now();
    db.$client.run(
      `insert into users (id, name, email, email_verified, created_at, updated_at)
       values ('u1', 'A', 'a@example.com', 0, ${now}, ${now})`,
    );
    db.$client.run(
      `insert into user_profiles (id, user_id, display_name, role, avatar, created_at, updated_at)
       values ('p1', 'u1', 'A', 'member', '{"archetype":"tycoon","hair":"pink"', ${now}, ${now})`,
    );
    expect(getProfileByUserId(db, "u1")?.avatar).toEqual(DEFAULT_GENIUS_LOOK);
    db.$client.close();
  });
});
