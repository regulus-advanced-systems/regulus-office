/**
 * Migration 0018 (#226): floors become operations and robots henchmen. A
 * database at 0017 full of fixture rows is migrated, and every row and
 * relation must survive under the new names.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "./index.ts";
import { all, insert, ROBOT_SPEC, type Row, seed, T } from "./operations-migration.fixture.ts";

const MIGRATIONS = join(import.meta.dir, "../../drizzle");
const dir = mkdtempSync(join(tmpdir(), "rg-operations-migration-"));
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

/** 0017 row → the row 0018 must leave behind. */
function renamed(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k.replace("floor", "operation")] = v;
  return out;
}

/** Columns later migrations added (0020: levels, #268); not part of what 0018 must keep. */
const LATER_COLUMNS = ["level_id", "dir_slug"];
const without = (row: Row): Row =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !LATER_COLUMNS.includes(k)));

const TABLES: Array<[string, string]> = [
  ["floors", "operations"],
  ["floor_repos", "operation_repos"],
  ["floor_members", "operation_members"],
  ["floor_queue_settings", "operation_queue_settings"],
  ["agents", "agents"],
  ["desks", "desks"],
  ["tasks", "tasks"],
  ["chat_messages", "chat_messages"],
  ["whiteboards", "whiteboards"],
  ["decor", "decor"],
  ["notification_channels", "notification_channels"],
  ["workflow_runs", "workflow_runs"],
  ["workflow_events", "workflow_events"],
  ["github_issues", "github_issues"],
  ["github_pulls", "github_pulls"],
  ["users", "users"],
];

describe("0018_operations_henchmen", () => {
  const db = openDatabase({ path: MEMORY_DB_PATH });
  const sql = db.$client;
  runMigrations(db, before("operations_henchmen"));
  seed(sql);
  const was = new Map(TABLES.map(([old]) => [old, all(sql, old)]));
  const auditBefore = all(sql, "audit_log");
  runMigrations(db);

  test("every row survives under the new table and column names", () => {
    for (const [old, now] of TABLES) {
      const rows = was.get(old) ?? [];
      expect(rows.length).toBeGreaterThan(0);
      expect(all(sql, now).map(without)).toEqual(rows.map(renamed));
    }
  });

  test("no table, column, index or constraint is named for floors any more", () => {
    const schema = sql
      .query("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL")
      .all() as Row[];
    expect(schema.filter((r) => /floor|robot/i.test(`${r.name} ${r.sql}`))).toEqual([]);
    const names = sql
      .query("SELECT name FROM sqlite_master")
      .all()
      .map((r) => (r as Row).name);
    expect(names).toEqual(
      expect.arrayContaining([
        "operations_slug_unique",
        "operation_repos_operation_owner_name_unique",
        "operation_members_operation_user_unique",
        "desks_operation_seat_unique",
        "whiteboards_operation_id_unique",
      ]),
    );
  });

  test("foreign keys point at the renamed tables and hold", () => {
    expect(sql.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sql.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    const seated = sql
      .query(
        `SELECT o.name AS operation, r.owner || '/' || r.name AS repo, d.seat_id AS seat, a.id AS agent
         FROM agents a JOIN operations o ON o.id = a.operation_id
         JOIN operation_repos r ON r.id = a.repo_id
         JOIN desks d ON d.agent_id = a.id`,
      )
      .all();
    expect(seated).toEqual([
      { operation: "Floor f1", repo: "octo/hello", seat: "d1s1", agent: "a1" },
    ]);
    const refs = (t: string) =>
      (sql.query(`PRAGMA foreign_key_list(${t})`).all() as Row[]).map(
        (f) => `${f.from}->${f.table}`,
      );
    expect(refs("agents")).toEqual(
      expect.arrayContaining(["operation_id->operations", "repo_id->operation_repos"]),
    );
    expect(refs("github_pulls")).toEqual(["repo_id->operation_repos"]);
    expect(refs("operation_members")).toEqual(
      expect.arrayContaining(["operation_id->operations", "user_id->users"]),
    );
  });

  test("unique indexes and checks still apply under their new names", () => {
    expect(() =>
      insert(sql, "operation_members", {
        id: "m9",
        operation_id: "f1",
        user_id: "u2",
        access: "view",
        ...T,
      }),
    ).toThrow(/UNIQUE/);
    expect(() =>
      insert(sql, "operation_members", {
        id: "m9",
        operation_id: "f1",
        user_id: "u1",
        access: "admin",
        ...T,
      }),
    ).toThrow(/operation_members_access_check/);
    expect(() =>
      insert(sql, "operation_repos", {
        id: "r9",
        operation_id: "f1",
        owner: "o",
        name: "n",
        url: "u",
        workdir: "/x",
        clone_status: "bogus",
        ...T,
      }),
    ).toThrow(/operation_repos_clone_status_check/);
  });

  test("audit actions, target kinds and meta keys are renamed; nothing else changes", () => {
    const after = all(sql, "audit_log");
    expect(after.map((r) => [r.id, r.action, r.target_kind])).toEqual([
      ["l1", "operation.create", "operation"],
      ["l2", "operation.member_set", "operation"],
      ["l3", "operation_repo.clone", "operation_repo"],
      ["l4", "agent.spawn", "agent"],
      ["l5", "agent.send_home", "agent"],
      ["l6", "user.update", "user"],
    ]);
    const meta = Object.fromEntries(after.map((r) => [r.id, JSON.parse(String(r.meta_json))]));
    expect(meta.l4).toEqual({ operationId: "f1", repoId: "r1", seatId: "d1s1" });
    expect(meta.l5).toEqual({ keepBranch: true, operationEvacuation: true });
    expect(meta.l1).toEqual(JSON.parse(String(auditBefore[0]?.meta_json)));
    expect(after.map((r) => [r.user_id, r.target_id, r.created_at])).toEqual(
      auditBefore.map((r) => [r.user_id, r.target_id, r.created_at]),
    );
  });

  test("a workflow's robot section becomes its henchman section", () => {
    const [wf] = all(sql, "workflows");
    const { robot, ...rest } = ROBOT_SPEC;
    expect(JSON.parse(String(wf?.spec_json))).toEqual({ ...rest, henchman: robot });
    expect(wf).toMatchObject({ id: "wf1", operation_id: "f1", name: "Review", enabled: 1 });
  });

  test("deleting an operation still cascades through the renamed tables", () => {
    sql.run("DELETE FROM operations WHERE id = 'f1'");
    for (const t of [
      "operation_repos",
      "operation_members",
      "desks",
      "agents",
      "tasks",
      "github_pulls",
    ])
      expect(all(sql, t).filter((r) => r.operation_id === "f1" || r.repo_id === "r1")).toEqual([]);
    expect(all(sql, "operation_members").map((r) => r.id)).toEqual(["m2"]);
  });
});
