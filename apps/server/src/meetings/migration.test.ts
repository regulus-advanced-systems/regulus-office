/**
 * Migration 0019 (#50): an office from before it gains the meeting tables,
 * existing rows are untouched, the enums are enforced by the database and
 * a meeting goes with its operation.
 */
import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "../db/index.ts";

const MIGRATIONS = join(import.meta.dir, "../../drizzle");
const dir = mkdtempSync(join(tmpdir(), "rg-meetings-migration-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function before(tag: string): string {
  const old = join(dir, `drizzle-${tag}`);
  cpSync(MIGRATIONS, old, { recursive: true });
  const journalPath = join(old, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((e) => e.tag.endsWith(tag));
  expect(at).toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, at);
  writeFileSync(journalPath, JSON.stringify(journal));
  return old;
}

test("0019 adds the meeting tables to an existing office", () => {
  const db = openDatabase({ path: MEMORY_DB_PATH });
  const sql = db.$client;
  runMigrations(db, before("meetings"));
  sql.run(
    "INSERT INTO operations (id, name, slug, `index`, palette_id, layout_template_id, created_at, updated_at) VALUES ('op', 'Op', 'op', 1, 'p', 't', 0, 0)",
  );
  sql.run(
    "INSERT INTO operation_repos (id, operation_id, owner, name, url, default_branch, workdir, is_primary, created_at, updated_at) VALUES ('r', 'op', 'o', 'n', 'u', 'main', '/w', 1, 0, 0)",
  );
  sql.run(
    "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'U', 'u@example.com', 0, 0, 0)",
  );
  const tables = () =>
    sql
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'meeting%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
  expect(tables()).toEqual([]);

  runMigrations(db);
  expect(tables()).toEqual(["meeting_members", "meeting_turns", "meetings"]);
  expect(sql.query<{ n: number }, []>("SELECT count(*) AS n FROM operations").get()?.n).toBe(1);

  const insert = (id: string, status: string) =>
    sql.run(
      `INSERT INTO meetings (id, operation_id, repo_id, started_by, pattern, topic, status, rounds, token_budget, turn_timeout_ms, output, created_at, updated_at)
       VALUES (?, 'op', 'r', 'u', 'debate', 'topic', ?, 2, 100000, 60000, 'notes', 0, 0)`,
      [id, status],
    );
  insert("m1", "running");
  expect(() => insert("m2", "sleeping")).toThrow();
  sql.run(
    "INSERT INTO meeting_members (id, meeting_id, position, role, name, provider, model, created_at, updated_at) VALUES ('mm', 'm1', 0, 'proposer', 'Proposer', 'codex', 'gpt', 0, 0)",
  );
  sql.run(
    "INSERT INTO meeting_turns (id, meeting_id, step, round, position, kind, status, started_at, created_at, updated_at) VALUES ('t', 'm1', 0, 1, 0, 'open', 'done', 0, 0, 0)",
  );
  expect(() =>
    sql.run(
      "INSERT INTO meeting_turns (id, meeting_id, step, round, position, kind, status, started_at, created_at, updated_at) VALUES ('t2', 'm1', 0, 1, 0, 'open', 'done', 0, 0, 0)",
    ),
  ).toThrow();

  sql.run("PRAGMA foreign_keys = ON");
  sql.run("DELETE FROM operations WHERE id = 'op'");
  for (const table of ["meetings", "meeting_members", "meeting_turns"]) {
    expect(sql.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
  }
});
