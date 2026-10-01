/**
 * Fixture rows for the 0018 migration test (#226): one of everything that
 * hangs off a floor, written with the 0017 table and column names.
 */
import type { Database } from "bun:sqlite";

export type Row = Record<string, unknown>;

export function insert(sql: Database, table: string, row: Row): void {
  const cols = Object.keys(row);
  sql.run(
    `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    Object.values(row) as never,
  );
}

export const all = (sql: Database, table: string): Row[] =>
  sql.query(`SELECT * FROM \`${table}\` ORDER BY rowid`).all() as Row[];

export const T = { created_at: 1, updated_at: 2 };
export const ROBOT_SPEC = {
  trigger: { event: "pull_request.opened" },
  robot: { provider: "claude-code", promptTemplate: "Review {{pr}}" },
  actions: { comment: true },
};

export function seed(sql: Database): void {
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
