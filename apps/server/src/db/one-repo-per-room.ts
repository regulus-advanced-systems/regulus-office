/**
 * Data step of the `levels_one_repo_per_room` migration (#268; D7 as changed
 * 2026-10-07, D26). Runs in `runMigrations`, right after the SQL migrations and
 * before anything else opens the database, in one write transaction:
 *
 * 1. Every operation with several repos is split into one operation per
 *    repo. The primary repo keeps the original operation and its room. Each
 *    other repo gets a new operation: same settings (size, desks, decor),
 *    not placed yet (the compound places it at boot, compound/migrate.ts).
 *    What follows a repo to its new operation: its henchmen and their desks,
 *    its queue tasks, its meetings, its boards and dev servers (they hang off
 *    the repo or the henchman), the queue settings, the workflows that target
 *    it, and a copy of every member. The whiteboard, wall pictures and chat stay with the original.
 * 2. Every operation with a repo that is still on the holding level moves to
 *    the level of its repo's owner, created on first use.
 * 3. The unique index that makes "one repo per operation" a rule of the
 *    database is created.
 *
 * Nothing on disk is touched. A split-off operation records the original's
 * directory name in `dir_slug`, so its mirror, every human's clone and every
 * worktree stay exactly where they are (operations/dirs.ts), and a running
 * henchman keeps its tmux session, worktree and sandbox: only the room it is
 * shown in changes.
 *
 * Written against the tables directly (bun:sqlite, no Drizzle schema) like a
 * SQL migration, so later schema changes in TypeScript cannot change what it
 * does. Idempotent: with nothing to split or move it only checks.
 */
import type { Database } from "bun:sqlite";
import { HOLDING_LEVEL_ID, LOBBY_LEVEL_ID, levelLoginOf } from "@regulus/protocol";
import { slugify, uniqueSlug } from "../operations/naming.ts";
import { splitWorkflows } from "./one-repo-per-room-workflows.ts";

export const ONE_REPO_INDEX = "operation_repos_operation_unique";
/** Audit action of one split (target: the original operation). */
export const OPERATION_SPLIT_ACTION = "operation.split";

const MAX_NAME = 80;

export interface SplitRoom {
  operationId: string;
  repoId: string;
  repo: string;
  name: string;
  slug: string;
  henchmen: number;
}

export interface OneRepoPerRoomResult {
  /** Operations that had several repos, with the rooms split off them. */
  split: Array<{ operationId: string; name: string; kept: string; rooms: SplitRoom[] }>;
  /** Operations moved from the holding level to their repo owner's level. */
  levelled: string[];
  /** Levels created for repo owners. */
  levels: string[];
}

interface RepoRow {
  id: string;
  operation_id: string;
  owner: string;
  name: string;
  is_primary: number;
}

interface OperationRow {
  id: string;
  name: string;
  slug: string;
  dir_slug: string | null;
}

type Sql = Database;

const all = <T>(sql: Sql, query: string, ...params: unknown[]): T[] =>
  sql.query(query).all(...(params as never[])) as T[];

const run = (sql: Sql, query: string, ...params: unknown[]): void => {
  sql.query(query).run(...(params as never[]));
};

function hasTable(sql: Sql, name: string): boolean {
  return all(sql, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", name).length > 0;
}

/** Slugs and directory names in use: a new slug must clash with neither. */
function takenSlugs(sql: Sql): Set<string> {
  const rows = all<{ slug: string; dir_slug: string | null }>(
    sql,
    "SELECT slug, dir_slug FROM operations",
  );
  return new Set(rows.flatMap((r) => (r.dir_slug ? [r.slug, r.dir_slug] : [r.slug])));
}

/** Move one repo of `from` into a new operation; returns the new room. */
function splitOff(sql: Sql, from: OperationRow, repo: RepoRow, now: number): SplitRoom {
  const id = crypto.randomUUID();
  const name = `${from.name} / ${repo.name}`.slice(0, MAX_NAME).trim();
  const slug = uniqueSlug(slugify(`${from.slug}-${repo.name}`), takenSlugs(sql));
  const [top] = all<{ n: number | null }>(sql, 'SELECT MAX("index") AS n FROM operations');
  run(
    sql,
    `INSERT INTO operations (id, name, slug, "index", palette_id, layout_template_id, grid_x, grid_y,
       width, depth, door_side, build_state, build_started_at, desk_count, decor_style, archived_at,
       level_id, dir_slug, created_at, updated_at)
     SELECT ?, ?, ?, ?, palette_id, layout_template_id, NULL, NULL,
       width, depth, door_side, 'ready', NULL, desk_count, decor_style, archived_at,
       level_id, COALESCE(dir_slug, slug), ?, ?
     FROM operations WHERE id = ?`,
    id,
    name,
    slug,
    (top?.n ?? 0) + 1,
    now,
    now,
    from.id,
  );

  // Desks: the new room has the same seats; a desk goes with the henchman sitting at it.
  const desks = all<{ id: string; seat_id: string; agent_id: string | null; moves: number }>(
    sql,
    `SELECT d.id, d.seat_id, d.agent_id,
       CASE WHEN a.repo_id = ? THEN 1 ELSE 0 END AS moves
     FROM desks d LEFT JOIN agents a ON a.id = d.agent_id
     WHERE d.operation_id = ? ORDER BY d.rowid`,
    repo.id,
    from.id,
  );
  for (const desk of desks) {
    if (desk.moves)
      run(sql, "UPDATE desks SET agent_id = NULL, updated_at = ? WHERE id = ?", now, desk.id);
  }
  for (const desk of desks) {
    run(
      sql,
      `INSERT INTO desks (id, operation_id, seat_id, agent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      id,
      desk.seat_id,
      desk.moves ? desk.agent_id : null,
      now,
      now,
    );
  }

  // Queue tasks bound to the repo, and unbound ones whose henchman works on it.
  run(
    sql,
    `UPDATE tasks SET operation_id = ?, updated_at = ?
     WHERE operation_id = ? AND (repo_id = ? OR (repo_id IS NULL AND agent_id IN
       (SELECT id FROM agents WHERE repo_id = ?)))`,
    id,
    now,
    from.id,
    repo.id,
    repo.id,
  );
  run(
    sql,
    `INSERT INTO operation_queue_settings (operation_id, max_running, max_per_owner, created_at, updated_at)
     SELECT ?, max_running, max_per_owner, ?, ? FROM operation_queue_settings WHERE operation_id = ?`,
    id,
    now,
    now,
    from.id,
  );
  const [moved] = all<{ n: number }>(
    sql,
    "SELECT COUNT(*) AS n FROM agents WHERE repo_id = ?",
    repo.id,
  );
  run(
    sql,
    "UPDATE agents SET operation_id = ?, updated_at = ? WHERE repo_id = ?",
    id,
    now,
    repo.id,
  );
  // A dev server's proxy path names the room (`/p/<operation>/a/<agent>/port/<n>/`).
  if (hasTable(sql, "services")) {
    run(
      sql,
      `UPDATE services SET url = replace(url, '/p/' || ? || '/a/', '/p/' || ? || '/a/'), updated_at = ?
       WHERE agent_id IN (SELECT id FROM agents WHERE repo_id = ?)`,
      from.id,
      id,
      now,
      repo.id,
    );
  }
  if (hasTable(sql, "meetings")) {
    run(
      sql,
      "UPDATE meetings SET operation_id = ?, updated_at = ? WHERE repo_id = ?",
      id,
      now,
      repo.id,
    );
  }
  run(
    sql,
    "UPDATE operation_repos SET operation_id = ?, is_primary = 1, updated_at = ? WHERE id = ?",
    id,
    now,
    repo.id,
  );

  // Members are copied: everyone keeps the access they had, in every resulting room.
  const members = all<{ user_id: string; access: string }>(
    sql,
    "SELECT user_id, access FROM operation_members WHERE operation_id = ? ORDER BY rowid",
    from.id,
  );
  for (const member of members) {
    run(
      sql,
      `INSERT INTO operation_members (id, operation_id, user_id, access, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      id,
      member.user_id,
      member.access,
      now,
      now,
    );
  }
  return {
    operationId: id,
    repoId: repo.id,
    repo: `${repo.owner}/${repo.name}`,
    name,
    slug,
    henchmen: moved?.n ?? 0,
  };
}

/** Team channels limited to some operations keep covering the rooms split off them. */
function extendChannelFilters(sql: Sql, added: ReadonlyMap<string, string[]>, now: number): void {
  if (added.size === 0 || !hasTable(sql, "notification_channels")) return;
  const rows = all<{ id: string; operation_ids_json: string | null }>(
    sql,
    "SELECT id, operation_ids_json FROM notification_channels WHERE operation_ids_json IS NOT NULL",
  );
  for (const row of rows) {
    let ids: unknown;
    try {
      ids = JSON.parse(row.operation_ids_json ?? "null");
    } catch {
      continue;
    }
    if (!Array.isArray(ids)) continue;
    const extra = ids.flatMap((id) => (typeof id === "string" ? (added.get(id) ?? []) : []));
    if (extra.length === 0) continue;
    run(
      sql,
      "UPDATE notification_channels SET operation_ids_json = ?, updated_at = ? WHERE id = ?",
      JSON.stringify([...ids, ...extra]),
      now,
      row.id,
    );
  }
}

/** The level of a repo owner, created (as an unconfirmed `account`) when there is none. */
function levelFor(sql: Sql, owner: string, now: number, created: string[]): string {
  const login = levelLoginOf(owner);
  const [found] = all<{ id: string }>(sql, "SELECT id FROM levels WHERE login = ?", login);
  if (found) return found.id;
  const [top] = all<{ n: number | null }>(
    sql,
    "SELECT MAX(position) AS n FROM levels WHERE id NOT IN (?, ?)",
    LOBBY_LEVEL_ID,
    HOLDING_LEVEL_ID,
  );
  const id = crypto.randomUUID();
  run(
    sql,
    `INSERT INTO levels (id, kind, github_id, login, name, position, created_at, updated_at)
     VALUES (?, 'account', NULL, ?, ?, ?, ?, ?)`,
    id,
    login,
    owner,
    (top?.n ?? 0) + 1,
    now,
    now,
  );
  created.push(id);
  return id;
}

function audit(sql: Sql, action: string, targetId: string, meta: unknown, now: number): void {
  run(
    sql,
    `INSERT INTO audit_log (id, user_id, action, target_kind, target_id, meta_json, created_at, updated_at)
     VALUES (?, NULL, ?, 'operation', ?, ?, ?, ?)`,
    crypto.randomUUID(),
    action,
    targetId,
    JSON.stringify(meta),
    now,
    now,
  );
}

/** See the module comment. Safe to call on every boot. */
export function ensureOneRepoPerRoom(sql: Sql, now: number = Date.now()): OneRepoPerRoomResult {
  const result: OneRepoPerRoomResult = { split: [], levelled: [], levels: [] };
  if (!hasTable(sql, "levels")) return result;
  sql
    .transaction(() => {
      const multi = all<{ operation_id: string }>(
        sql,
        `SELECT operation_id FROM operation_repos GROUP BY operation_id HAVING COUNT(*) > 1
         ORDER BY operation_id`,
      );
      const added = new Map<string, string[]>();
      for (const { operation_id } of multi) {
        const [from] = all<OperationRow>(
          sql,
          "SELECT id, name, slug, dir_slug FROM operations WHERE id = ?",
          operation_id,
        );
        if (!from) continue;
        const repos = all<RepoRow>(
          sql,
          `SELECT id, operation_id, owner, name, is_primary FROM operation_repos
           WHERE operation_id = ? ORDER BY is_primary DESC, created_at, rowid`,
          operation_id,
        );
        const [keep, ...others] = repos;
        if (!keep) continue;
        const rooms = others.map((repo) => splitOff(sql, from, repo, now));
        splitWorkflows(sql, from.id, keep.id, rooms, now);
        run(sql, "UPDATE operation_repos SET is_primary = 1 WHERE id = ?", keep.id);
        added.set(
          from.id,
          rooms.map((r) => r.operationId),
        );
        const kept = `${keep.owner}/${keep.name}`;
        audit(sql, OPERATION_SPLIT_ACTION, from.id, { name: from.name, kept, rooms }, now);
        result.split.push({ operationId: from.id, name: from.name, kept, rooms });
      }
      extendChannelFilters(sql, added, now);

      const unlevelled = all<{ id: string; owner: string }>(
        sql,
        `SELECT o.id, r.owner FROM operations o JOIN operation_repos r ON r.operation_id = o.id
         WHERE o.level_id = ? ORDER BY o."index", o.created_at, o.id`,
        HOLDING_LEVEL_ID,
      );
      for (const row of unlevelled) {
        const levelId = levelFor(sql, row.owner, now, result.levels);
        run(sql, "UPDATE operations SET level_id = ? WHERE id = ?", levelId, row.id);
        result.levelled.push(row.id);
      }
      run(
        sql,
        `CREATE UNIQUE INDEX IF NOT EXISTS \`${ONE_REPO_INDEX}\` ON \`operation_repos\` (\`operation_id\`)`,
      );
    })
    .immediate();
  return result;
}
