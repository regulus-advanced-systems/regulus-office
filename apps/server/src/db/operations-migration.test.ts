/**
 * Migration 0018 (#226): floors become operations and robots henchmen. A
 * database at 0017 full of fixture rows is migrated, and every row and
 * relation must survive under the new names.
 */

import type { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "./index.ts";

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

type Row = Record<string, unknown>;

function insert(sql: Database, table: string, row: Row): void {
  const cols = Object.keys(row);
  sql.run(
    `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    Object.values(row) as never,
  );
}

const all = (sql: Database, table: string): Row[] =>
  sql.query(`SELECT * FROM \`${table}\` ORDER BY rowid`).all() as Row[];

const T = { created_at: 1, updated_at: 2 };
const ROBOT_SPEC = {
  trigger: { event: "pull_request.opened" },
  robot: { provider: "claude-code", promptTemplate: "Review {{pr}}" },
  actions: { comment: true },
};

/** One of everything that hangs off a floor, written with the 0017 names. */
function seed(sql: Database): void {
  for (const id of ["u1", "u2"]) insert(sql, "users", { id, name: id, email: `${id}@x`, ...T });
  for (const [i, id] of ["f1", "f2"].entries())
    insert(sql, "floors", {
      id,
      name: `Floor ${id}`,
      slug: `slug-${id}`,
      index: i + 1,
      palette_id: "p",
      layout_template_id: "room",
      grid_x: i * 12,
      grid_y: 3,
      desk_count: 2,
      ...T,
    });
  insert(sql, "floor_repos", {
    id: "r1",
    floor_id: "f1",
    owner: "octo",
    name: "hello",
    url: "https://github.com/octo/hello",
    workdir: "/srv/office/projects/slug-f1/hello",
    is_primary: 1,
    clone_status: "ready",
    encrypted_credential: "v1.ciphertext",
    ...T,
  });
  insert(sql, "floor_repos", {
    id: "r2",
    floor_id: "f2",
    owner: "octo",
    name: "world",
    url: "https://github.com/octo/world",
    workdir: "/w2",
    clone_status: "error",
    clone_error: "boom",
    ...T,
  });
  insert(sql, "floor_members", { id: "m1", floor_id: "f1", user_id: "u2", access: "spawn", ...T });
  insert(sql, "floor_members", { id: "m2", floor_id: "f2", user_id: "u2", access: "manage", ...T });
  insert(sql, "agents", {
    id: "a1",
    floor_id: "f1",
    repo_id: "r1",
    desk_seat_id: "d1s1",
    owner_user_id: "u2",
    provider: "claude-code",
    model: "opus",
    profile_id: "p1",
    status: "working",
    workdir: "/w/a1",
    task_title: "Fix it",
    spawn_args_json: '{"seatId":"d1s1"}',
    ...T,
  });
  insert(sql, "desks", { id: "k1", floor_id: "f1", seat_id: "d1s1", agent_id: "a1", ...T });
  insert(sql, "desks", { id: "k2", floor_id: "f1", seat_id: "d1s2", ...T });
  insert(sql, "tasks", {
    id: "t1",
    floor_id: "f1",
    repo_id: "r1",
    position: 1,
    kind: "issue",
    prompt: "do it",
    provider: "codex",
    model: "gpt",
    created_by: "u2",
    agent_id: "a1",
    state: "running",
    ...T,
  });
  insert(sql, "floor_queue_settings", { floor_id: "f1", max_running: 3, max_per_owner: 1, ...T });
  insert(sql, "chat_messages", {
    id: "c1",
    user_id: "u2",
    display_name: "U2",
    floor_id: "f1",
    text: "hi",
    ts: 5,
    ...T,
  });
  insert(sql, "chat_messages", {
    id: "c2",
    user_id: "u2",
    display_name: "U2",
    text: "lobby",
    ts: 6,
    ...T,
  });
  insert(sql, "whiteboards", { id: "w1", floor_id: "f1", ...T });
  insert(sql, "decor", {
    id: "e1",
    floor_id: "f1",
    kind: "plant",
    wall_id: "n",
    x: 1,
    y: 2,
    w: 1,
    h: 1,
    placed_by: "u1",
    ...T,
  });
  insert(sql, "decor", {
    id: "e2",
    kind: "poster",
    wall_id: "lobby",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    ...T,
  });
  insert(sql, "notification_channels", {
    id: "n1",
    kind: "slack",
    label: "ops",
    encrypted_secret: "v1.secret",
    floor_ids_json: '["f1","f2"]',
    ...T,
  });
  insert(sql, "notification_channels", {
    id: "n2",
    kind: "discord",
    label: "all",
    encrypted_secret: "v1.s",
    ...T,
  });
  insert(sql, "workflows", {
    id: "wf1",
    floor_id: "f1",
    name: "Review",
    enabled: 1,
    spec_json: JSON.stringify(ROBOT_SPEC),
    created_by: "u1",
    ...T,
  });
  insert(sql, "workflow_runs", {
    id: "run1",
    workflow_id: "wf1",
    floor_id: "f1",
    delivery_id: "d-1",
    trigger: "pull_request.opened",
    context_json: "{}",
    status: "succeeded",
    provider: "claude-code",
    day: "2026-10-01",
    queued_at: 10,
    ...T,
  });
  insert(sql, "workflow_events", {
    id: "ev1",
    delivery_id: "d-1",
    name: "pull_request",
    summary: "PR opened",
    floor_ids_json: '["f1"]',
    event_json: "{}",
    received_at: 9,
    ...T,
  });
  insert(sql, "github_issues", {
    id: "gi1",
    repo_id: "r1",
    number: 7,
    title: "Bug",
    state: "open",
    gh_updated_at: 3,
    ...T,
  });
  insert(sql, "github_pulls", {
    id: "gp1",
    repo_id: "r1",
    number: 8,
    title: "Fix",
    state: "open",
    gh_updated_at: 4,
    ...T,
  });
  const audit = (id: string, action: string, target_kind: string, meta: Row) =>
    insert(sql, "audit_log", {
      id,
      user_id: "u1",
      action,
      target_kind,
      target_id: "f1",
      meta_json: JSON.stringify(meta),
      ...T,
    });
  audit("l1", "floor.create", "floor", { name: "Floor f1" });
  audit("l2", "floor.member_set", "floor", { userId: "u2", access: "spawn" });
  audit("l3", "floor_repo.clone", "floor_repo", { repo: "octo/hello" });
  audit("l4", "agent.spawn", "agent", { floorId: "f1", repoId: "r1", seatId: "d1s1" });
  audit("l5", "agent.send_home", "agent", { keepBranch: true, floorEvacuation: true });
  audit("l6", "user.update", "user", { role: "member" });
}

/** 0017 row → the row 0018 must leave behind. */
function renamed(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k.replace("floor", "operation")] = v;
  return out;
}

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
      expect(all(sql, now)).toEqual(rows.map(renamed));
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
