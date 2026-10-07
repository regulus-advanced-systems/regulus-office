/**
 * The `levels_one_repo_per_room` migration (#268). A database from just before
 * it, holding an office from the 1..n-repos days, is migrated; every operation
 * must end up with exactly one repo on its repo owner's level, everything
 * bound to a repo must have followed it, running henchmen must be untouched
 * apart from the room they are in, and nothing on disk may change.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOLDING_LEVEL_ID, LOBBY_LEVEL_ID } from "@regulus/protocol";
import { defaultCompoundSpec } from "@regulus/room-layout";
import { CompoundService } from "../compound/service.ts";
import { createLogger } from "../logging.ts";
import { operationDirName } from "../operations/dirs.ts";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "./index.ts";
import {
  migrationsBefore,
  SEATS,
  seedMultiRepoOffice,
  spec,
  tree,
} from "./one-repo-per-room.fixture.ts";
import { ensureOneRepoPerRoom, ONE_REPO_INDEX } from "./one-repo-per-room.ts";
import { all, insert, type Row, T } from "./operations-migration.fixture.ts";

const dir = mkdtempSync(join(tmpdir(), "rg268-migration-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const before = (tag: string) => migrationsBefore(dir, tag);

const TOUCHED = ["operation_id", "is_primary", "updated_at", "url", "spec_json"];
const untouched = (row: Row | undefined): Row =>
  Object.fromEntries(Object.entries(row ?? {}).filter(([k]) => !TOUCHED.includes(k)));
const byId = (rows: Row[]) => new Map(rows.map((r) => [String(r.id), r]));

describe("levels_one_repo_per_room migration", async () => {
  // The office's files as they are on a real host: mirrors, a human's clone, worktrees.
  const root = join(dir, "srv-office");
  for (const path of [
    "projects/apollo/web/.git",
    "projects/apollo/api/.git",
    "projects/apollo/docs/.git",
    "worktrees/apollo/u2/_clones/api/.git",
    "worktrees/apollo/u2/a-api",
    "worktrees/apollo/u2/a-web",
  ]) {
    await mkdir(join(root, path), { recursive: true });
  }
  await Bun.write(join(root, "worktrees/apollo/u2/a-api/uncommitted.txt"), "work in progress\n");
  const filesBefore = await tree(root);

  const db = openDatabase({ path: MEMORY_DB_PATH });
  const sql = db.$client;
  runMigrations(db, before("levels_one_repo_per_room"));
  seedMultiRepoOffice(sql, root);
  // A live office has its compound: the rooms are where their owners built them.
  const grid = defaultCompoundSpec(64);
  insert(sql, "compound", {
    id: "main",
    width: grid.width,
    depth: grid.depth,
    lobby_grid_x: grid.lobby.x,
    lobby_grid_y: grid.lobby.y,
    lobby_width: grid.lobby.w,
    lobby_depth: grid.lobby.d,
    ...T,
  });
  const was = {
    repos: byId(all(sql, "operation_repos")),
    agents: byId(all(sql, "agents")),
    tasks: byId(all(sql, "tasks")),
    issues: all(sql, "github_issues"),
    pulls: all(sql, "github_pulls"),
    kept: ["whiteboards", "decor", "chat_messages", "users"].map((t) => [t, all(sql, t)] as const),
  };
  const result = runMigrations(db);

  const operation = (slug: string) =>
    sql.query("SELECT * FROM operations WHERE slug = ?").get(slug) as Row;
  const level = (login: string) =>
    sql.query("SELECT * FROM levels WHERE login = ?").get(login) as Row;
  const on = (table: string, operationId: unknown) =>
    sql
      .query(`SELECT * FROM \`${table}\` WHERE operation_id = ? ORDER BY rowid`)
      .all(operationId as string) as Row[];
  const apollo = operation("apollo");
  const api = operation("apollo-api");
  const docs = operation("apollo-docs");

  test("every operation has exactly one repo, and the database enforces it", () => {
    const counts = sql
      .query(
        `SELECT o.slug, COUNT(r.id) AS n FROM operations o
         LEFT JOIN operation_repos r ON r.operation_id = o.id GROUP BY o.id ORDER BY o."index"`,
      )
      .all();
    expect(counts).toEqual([
      { slug: "apollo", n: 1 },
      { slug: "solo", n: 1 },
      { slug: "empty", n: 0 },
      { slug: "retired", n: 1 },
      { slug: "apollo-api", n: 1 },
      { slug: "apollo-docs", n: 1 },
      { slug: "retired-b", n: 1 },
    ]);
    expect(all(sql, "operation_repos").every((r) => r.is_primary === 1)).toBe(true);
    expect(sql.query("SELECT name FROM sqlite_master WHERE name = ?").get(ONE_REPO_INDEX)).toEqual({
      name: ONE_REPO_INDEX,
    });
    expect(() =>
      sql.run(
        `INSERT INTO operation_repos (id, operation_id, owner, name, url, workdir, created_at, updated_at)
         VALUES ('r-second', 'apollo', 'octo', 'second', 'u', '/w', 1, 1)`,
      ),
    ).toThrow(/UNIQUE constraint failed: operation_repos.operation_id/);
    expect(sql.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sql.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });

  test("the primary repo keeps the operation and its room; each other repo gets a new room", () => {
    // The original: same id, name, slug and placement.
    expect(apollo).toMatchObject({
      id: "apollo",
      name: "Apollo",
      grid_x: 4,
      grid_y: 40,
      dir_slug: null,
    });
    expect(on("operation_repos", "apollo").map((r) => r.id)).toEqual(["r-web"]);
    for (const [room, repoId, name] of [
      [api, "r-api", "Apollo / api"],
      [docs, "r-docs", "Apollo / docs"],
    ] as const) {
      expect(on("operation_repos", room.id).map((r) => r.id)).toEqual([repoId]);
      // Same settings as the original; no spot yet (the compound places it at boot); and
      // the original's directory name, so nothing on disk has to move.
      expect(room).toMatchObject({
        name,
        dir_slug: "apollo",
        grid_x: null,
        grid_y: null,
        width: 10,
        depth: 12,
        door_side: "south",
        build_state: "ready",
        desk_count: 2,
        decor_style: "lab",
        palette_id: "oak-sky",
        layout_template_id: "room",
        archived_at: null,
      });
    }
    expect([api.index, docs.index]).toEqual([5, 6]);
    // An archived operation is split too, and its rooms stay archived.
    expect(operation("retired-b")).toMatchObject({
      name: "Retired / b",
      archived_at: 77,
      dir_slug: "retired",
    });
    expect(result.split.map((s) => [s.operationId, s.kept, s.rooms.map((r) => r.repo)])).toEqual([
      ["apollo", "octo/web", ["octo/api", "Acme/docs"]],
      ["retired", "zed/a", ["zed/b"]],
    ]);
  });

  test("every operation is on its repo owner's level; no repo means the holding level", () => {
    const levels = all(sql, "levels").map((l) => [
      l.id === level("octo").id ? "octo" : l.id,
      l.kind,
      l.login,
      l.name,
      l.position,
    ]);
    expect(levels).toEqual([
      [LOBBY_LEVEL_ID, "lobby", null, "Lobby", 0],
      [HOLDING_LEVEL_ID, "holding", null, "Unassigned", 65535],
      // In the order of the operations people knew; an owner's level is an account until
      // GitHub confirms what it is. Logins are case-insensitive: Octo/Solo is on octo's level.
      ["octo", "account", "octo", "octo", 1],
      [level("zed").id, "account", "zed", "zed", 2],
      [level("acme").id, "account", "acme", "Acme", 3],
    ]);
    const levelOf = (slug: string) => operation(slug).level_id;
    expect(levelOf("apollo")).toBe(level("octo").id);
    expect(levelOf("apollo-api")).toBe(level("octo").id);
    expect(levelOf("solo")).toBe(level("octo").id);
    // A split-off repo of another owner goes to that owner's level (SPEC D7), not the original's.
    expect(levelOf("apollo-docs")).toBe(level("acme").id);
    expect(levelOf("retired")).toBe(level("zed").id);
    expect(levelOf("retired-b")).toBe(level("zed").id);
    expect(levelOf("empty")).toBe(HOLDING_LEVEL_ID);
    expect(all(sql, "levels").every((l) => l.github_id === null)).toBe(true);
    // Nobody is on the lobby level: it has no project rooms.
    expect(all(sql, "operations").some((o) => o.level_id === LOBBY_LEVEL_ID)).toBe(false);
  });

  test("a repo keeps its mirror path, credential and clone state", () => {
    for (const row of all(sql, "operation_repos")) {
      expect(untouched(row)).toEqual(untouched(was.repos.get(String(row.id))));
    }
    expect(
      sql
        .query(
          "SELECT workdir, encrypted_credential, clone_status, clone_error FROM operation_repos WHERE id = 'r-docs'",
        )
        .get(),
    ).toEqual({
      workdir: `${root}/projects/apollo/docs`,
      encrypted_credential: "v1.docs-pat",
      clone_status: "error",
      clone_error: "boom",
    });
  });

  test("henchmen follow their repo and change in nothing but the room they are in", () => {
    const now = byId(all(sql, "agents"));
    expect([...now.values()].map((a) => [a.id, a.operation_id])).toEqual([
      ["a-web", "apollo"],
      ["a-api", api.id],
      ["a-api-wait", api.id],
      ["a-api-gone", api.id],
    ]);
    // Status, tmux session, worktree path and branch, seat, hook token: all as they were.
    for (const [id, row] of now) expect(untouched(row)).toEqual(untouched(was.agents.get(id)));
    expect(now.get("a-api")).toMatchObject({
      status: "working",
      tmux_session: "agent-a-api",
      workdir: `${root}/worktrees/apollo/u2/a-api`,
      desk_seat_id: "d1s2",
      hook_token_hash: "hash-a-api",
    });
  });

  test("desks: each room has every seat; a desk goes with the henchman sitting at it", () => {
    const seats = (operationId: unknown) =>
      Object.fromEntries(on("desks", operationId).map((d) => [d.seat_id, d.agent_id]));
    const free = Object.fromEntries(SEATS.map((s) => [s, null]));
    expect(seats("apollo")).toEqual({ ...free, d1s1: "a-web" });
    expect(seats(api.id)).toEqual({ ...free, d1s2: "a-api", d2s1: "a-api-wait" });
    expect(seats(docs.id)).toEqual(free);
    expect(seats("solo")).toEqual({ d1s1: null });
  });

  test("queue, meetings, boards, dev servers and members follow the repo", () => {
    const tasks = (operationId: unknown) =>
      on("tasks", operationId).map((t) => [t.id, t.position, t.state]);
    expect(tasks("apollo")).toEqual([
      ["t-web", 1, "done"],
      ["t-primary", 3, "queued"],
    ]);
    expect(tasks(api.id)).toEqual([
      ["t-api", 2, "running"],
      ["t-follow", 4, "running"],
    ]);
    expect(tasks(docs.id)).toEqual([["t-docs", 5, "failed"]]);
    for (const row of all(sql, "tasks")) {
      expect(untouched(row)).toEqual(untouched(was.tasks.get(String(row.id))));
    }
    expect(
      all(sql, "operation_queue_settings").map((q) => [
        q.operation_id,
        q.max_running,
        q.max_per_owner,
      ]),
    ).toEqual([
      ["apollo", 3, 2],
      [api.id, 3, 2],
      [docs.id, 3, 2],
    ]);
    expect(sql.query("SELECT operation_id FROM meetings WHERE id = 'mt-api'").get()).toEqual({
      operation_id: api.id,
    });
    // Boards hang off the repo: untouched, and now read through the repo's new room.
    expect(all(sql, "github_issues")).toEqual(was.issues);
    expect(all(sql, "github_pulls")).toEqual(was.pulls);
    expect(sql.query("SELECT url, pid, port FROM services WHERE id = 'sv-api'").get()).toEqual({
      url: `/p/${api.id}/a/a-api/port/5173/`,
      pid: 4242,
      port: 5173,
    });
    const members = (operationId: unknown) =>
      on("operation_members", operationId).map((m) => [m.user_id, m.access]);
    const everyone = [
      ["u2", "spawn"],
      ["u3", "manage"],
    ];
    expect(members("apollo")).toEqual(everyone);
    expect(members(api.id)).toEqual(everyone);
    expect(members(docs.id)).toEqual(everyone);
    expect(members("solo")).toEqual([["u2", "view"]]);
    expect(members("retired-b")).toEqual([]);
  });

  test("workflows end up in the rooms whose repo they were for", () => {
    const pulls = { kind: "pull_request", actions: ["opened"] };
    const flows = (operationId: unknown) =>
      on("workflows", operationId).map((w) => [w.name, w.enabled, w.spec_json]);
    expect(flows("apollo")).toEqual([
      ["wf-all", 1, spec(pulls, [])],
      // A schedule without repos ran for the primary repo only: it stays, uncopied.
      ["wf-nightly", 1, spec({ kind: "schedule", cron: "0 3 * * *" }, [])],
      ["wf-web-docs", 1, spec(pulls, ["r-web"])],
      ["wf-broken", 1, "not json"],
    ]);
    expect(flows(api.id)).toEqual([
      ["wf-api", 0, spec(pulls, ["r-api"])],
      ["wf-all", 1, spec(pulls, [])],
    ]);
    expect(flows(docs.id)).toEqual([
      ["wf-all", 1, spec(pulls, [])],
      ["wf-web-docs", 1, spec(pulls, ["r-docs"])],
    ]);
    // A workflow that moved took its run history along, under its own id.
    expect(sql.query("SELECT id, operation_id FROM workflows WHERE name = 'wf-api'").get()).toEqual(
      {
        id: "wf-api",
        operation_id: api.id,
      },
    );
    expect(sql.query("SELECT workflow_id, operation_id FROM workflow_runs").all()).toEqual([
      { workflow_id: "wf-api", operation_id: api.id },
    ]);
  });

  test("the room keeps what belongs to the room; channel filters cover the new rooms", () => {
    for (const [table, rows] of was.kept) expect(all(sql, table)).toEqual(rows);
    expect(
      all(sql, "notification_channels").map((c) => [
        c.id,
        JSON.parse(String(c.operation_ids_json)),
      ]),
    ).toEqual([
      ["n-some", ["apollo", "solo", api.id, docs.id]],
      ["n-all", null],
    ]);
    const audit = sql
      .query("SELECT target_id, user_id, meta_json FROM audit_log WHERE action = 'operation.split'")
      .all() as Row[];
    expect(audit.map((a) => [a.target_id, a.user_id])).toEqual([
      ["apollo", null],
      ["retired", null],
    ]);
    expect(JSON.parse(String(audit[0]?.meta_json))).toMatchObject({
      name: "Apollo",
      kept: "octo/web",
      rooms: [
        { operationId: api.id, repo: "octo/api", slug: "apollo-api", henchmen: 3 },
        { operationId: docs.id, repo: "Acme/docs", slug: "apollo-docs", henchmen: 0 },
      ],
    });
    // Credentials are not copied into the audit log.
    expect(JSON.stringify(audit)).not.toContain("v1.");
  });

  test("at boot the new rooms get a spot on their own level; the others keep theirs", () => {
    const compound = new CompoundService({
      db,
      logger: createLogger({ level: "silent" }),
      config: { buildMs: 0, sizeTiles: 64 },
    });
    const booted = compound.boot();
    compound.close();
    // Archived rooms are placed when they are restored.
    expect([...booted.placed].sort()).toEqual([String(api.id), String(docs.id)].sort());
    expect(booted.unplaced).toEqual([]);
    const placed = (slug: string) => {
      const o = operation(slug);
      return { x: o.grid_x, y: o.grid_y, w: o.width, d: o.depth };
    };
    expect(placed("apollo")).toEqual({ x: 4, y: 40, w: 10, d: 12 });
    expect(placed("solo")).toEqual({ x: 18, y: 40, w: 10, d: 12 });
    expect(placed("empty")).toEqual({ x: 32, y: 40, w: 10, d: 12 });
    // On octo's level beside apollo and solo, clear of both.
    const a = placed("apollo-api");
    expect(a.x).not.toBeNull();
    const overlaps = (o: ReturnType<typeof placed>) =>
      Number(a.x) < Number(o.x) + Number(o.w) &&
      Number(o.x) < Number(a.x) + Number(a.w) &&
      Number(a.y) < Number(o.y) + Number(o.d) &&
      Number(o.y) < Number(a.y) + Number(a.d);
    expect(overlaps(placed("apollo")) || overlaps(placed("solo"))).toBe(false);
    // Alone on acme's level: it may well sit on tiles that are taken on octo's.
    expect(placed("apollo-docs").x).not.toBeNull();
    const snapshot = compound.snapshot();
    // The lobby first, the holding level last; zed's level has only archived rooms: not shown.
    expect(snapshot.levels?.map((l) => [l.login, l.kind])).toEqual([
      ["", "lobby"],
      ["octo", "account"],
      ["acme", "account"],
      ["", "holding"],
    ]);
    // Files of a split-off room are still found under the original's directory name.
    expect(operationDirName({ slug: String(api.slug), dirSlug: api.dir_slug as string })).toBe(
      "apollo",
    );
  });

  test("nothing on disk is created, moved or deleted", async () => {
    expect(await tree(root)).toEqual(filesBefore);
  });

  test("running it again changes nothing", () => {
    const tables = [
      "operations",
      "operation_repos",
      "levels",
      "desks",
      "agents",
      "tasks",
      "workflows",
      "operation_members",
      "audit_log",
      "notification_channels",
    ];
    const snapshot = () => tables.map((t) => all(sql, t));
    const first = snapshot();
    expect(runMigrations(db)).toEqual({ split: [], levelled: [], levels: [] });
    expect(ensureOneRepoPerRoom(sql)).toEqual({ split: [], levelled: [], levels: [] });
    expect(snapshot()).toEqual(first);
  });

  test("an empty database gets the two fixed levels and the index, nothing else", () => {
    const fresh = openDatabase({ path: MEMORY_DB_PATH });
    expect(runMigrations(fresh)).toEqual({ split: [], levelled: [], levels: [] });
    expect(all(fresh.$client, "levels").map((l) => l.id)).toEqual([
      LOBBY_LEVEL_ID,
      HOLDING_LEVEL_ID,
    ]);
    expect(
      fresh.$client.query("SELECT name FROM sqlite_master WHERE name = ?").get(ONE_REPO_INDEX),
    ).not.toBeNull();
    fresh.$client.close();
  });
});
