/**
 * Fixture rows for the levels migration test (#268), written with the earlier
 * tables: an office from the 1..n-repos days.
 *
 * - `apollo`: three repos (octo/web primary, octo/api, Acme/docs), two
 *   members, eight desks, henchmen on two of the repos (one of them running),
 *   queue tasks, a meeting, boards, a dev server, workflows, wall decor, a
 *   whiteboard, chat, and a shared office agent's grant and question.
 * - `solo`: one repo (Octo/Solo: the same owner as apollo's, typed differently).
 * - `empty`: no repo at all.
 * - `retired`: archived, two repos of a third owner.
 */
import type { Database } from "bun:sqlite";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { insert, T } from "./operations-migration.fixture.ts";

export const SEATS = ["d1s1", "d1s2", "d1s3", "d1s4", "d2s1", "d2s2", "d2s3", "d2s4"];

export const spec = (trigger: unknown, repoIds: string[]) =>
  JSON.stringify({ trigger, filters: { repoIds, bots: "exclude" }, actions: { comment: true } });
const PULLS = { kind: "pull_request", actions: ["opened"] };

function operation(sql: Database, id: string, index: number, extra: Record<string, unknown> = {}) {
  insert(sql, "operations", {
    id,
    name: id[0]?.toUpperCase() + id.slice(1),
    slug: id,
    index,
    palette_id: "oak-sky",
    layout_template_id: "room",
    grid_x: 4 + (index - 1) * 14,
    grid_y: 40,
    width: 10,
    depth: 12,
    door_side: "south",
    desk_count: 2,
    decor_style: "lab",
    ...T,
    created_at: index,
    ...extra,
  });
}

function repo(
  sql: Database,
  id: string,
  operationId: string,
  full: string,
  root: string,
  extra: Record<string, unknown> = {},
) {
  const [owner, name] = full.split("/") as [string, string];
  insert(sql, "operation_repos", {
    id,
    operation_id: operationId,
    owner,
    name,
    url: `https://github.com/${full}`,
    default_branch: "main",
    workdir: `${root}/projects/${operationId}/${name}`,
    is_primary: 0,
    clone_status: "ready",
    ...T,
    ...extra,
  });
}

function agent(
  sql: Database,
  id: string,
  repoId: string,
  seat: string,
  status: string,
  root: string,
) {
  insert(sql, "agents", {
    id,
    operation_id: "apollo",
    repo_id: repoId,
    desk_seat_id: seat,
    owner_user_id: "u2",
    provider: "claude-code",
    model: "opus",
    profile_id: "login:claude",
    status,
    tmux_session: `agent-${id}`,
    workdir: `${root}/worktrees/apollo/u2/${id}`,
    worktree_branch: `office/${id}`,
    task_title: `Task of ${id}`,
    hook_token_hash: `hash-${id}`,
    spawn_args_json: JSON.stringify({ seatId: seat }),
    ...T,
  });
}

/** Seed the office; `root` is where its (pretend) projects and worktrees dirs are. */
export function seedMultiRepoOffice(sql: Database, root: string): void {
  for (const id of ["u1", "u2", "u3"])
    insert(sql, "users", { id, name: id, email: `${id}@x`, ...T });

  operation(sql, "apollo", 1);
  operation(sql, "solo", 2);
  operation(sql, "empty", 3);
  operation(sql, "retired", 4, { archived_at: 77, grid_x: null, grid_y: null });

  // Created in this order; the primary is not the oldest, to show that `is_primary` decides.
  repo(sql, "r-api", "apollo", "octo/api", root, { created_at: 1 });
  repo(sql, "r-web", "apollo", "octo/web", root, {
    created_at: 2,
    is_primary: 1,
    encrypted_credential: "v1.web-pat",
  });
  repo(sql, "r-docs", "apollo", "Acme/docs", root, {
    created_at: 3,
    clone_status: "error",
    clone_error: "boom",
    encrypted_credential: "v1.docs-pat",
  });
  repo(sql, "r-solo", "solo", "Octo/Solo", root, { is_primary: 1 });
  repo(sql, "r-old-a", "retired", "zed/a", root, { is_primary: 1, created_at: 1 });
  repo(sql, "r-old-b", "retired", "zed/b", root, { created_at: 2 });

  insert(sql, "operation_members", {
    id: "m1",
    operation_id: "apollo",
    user_id: "u2",
    access: "spawn",
    ...T,
  });
  insert(sql, "operation_members", {
    id: "m2",
    operation_id: "apollo",
    user_id: "u3",
    access: "manage",
    ...T,
  });
  insert(sql, "operation_members", {
    id: "m3",
    operation_id: "solo",
    user_id: "u2",
    access: "view",
    ...T,
  });

  agent(sql, "a-web", "r-web", "d1s1", "working", root);
  // The running henchman whose operation is split from under it.
  agent(sql, "a-api", "r-api", "d1s2", "working", root);
  agent(sql, "a-api-wait", "r-api", "d2s1", "waiting_input", root);
  // Sent home long ago: no desk any more.
  agent(sql, "a-api-gone", "r-api", "d1s3", "exited", root);
  const seated: Record<string, string> = { d1s1: "a-web", d1s2: "a-api", d2s1: "a-api-wait" };
  for (const [i, seat] of SEATS.entries()) {
    insert(sql, "desks", {
      id: `k${i + 1}`,
      operation_id: "apollo",
      seat_id: seat,
      agent_id: seated[seat] ?? null,
      ...T,
    });
  }
  insert(sql, "desks", { id: "ks1", operation_id: "solo", seat_id: "d1s1", ...T });

  const task = (id: string, position: number, extra: Record<string, unknown>) =>
    insert(sql, "tasks", {
      id,
      operation_id: "apollo",
      position,
      kind: "freeform",
      prompt: `do ${id}`,
      provider: "claude-code",
      model: "opus",
      created_by: "u2",
      ...T,
      ...extra,
    });
  task("t-web", 1, { repo_id: "r-web", state: "done" });
  task("t-api", 2, { repo_id: "r-api", state: "running", agent_id: "a-api" });
  // No repo means the primary repo: it stays, unless its henchman works on another repo.
  task("t-primary", 3, { state: "queued" });
  task("t-follow", 4, { state: "running", agent_id: "a-api-wait" });
  task("t-docs", 5, { repo_id: "r-docs", state: "failed" });
  insert(sql, "operation_queue_settings", {
    operation_id: "apollo",
    max_running: 3,
    max_per_owner: 2,
    ...T,
  });

  insert(sql, "meetings", {
    id: "mt-api",
    operation_id: "apollo",
    repo_id: "r-api",
    started_by: "u2",
    pattern: "debate",
    topic: "API shape",
    status: "done",
    rounds: 2,
    token_budget: 1000,
    turn_timeout_ms: 1000,
    output: "notes",
    workdir: `${root}/worktrees/apollo/u2/meeting-mt-api`,
    ...T,
  });
  for (const [id, repoId, number] of [
    ["gi-web", "r-web", 1],
    ["gi-api", "r-api", 2],
  ] as const) {
    insert(sql, "github_issues", {
      id,
      repo_id: repoId,
      number,
      title: id,
      state: "open",
      gh_updated_at: 3,
      ...T,
    });
  }
  insert(sql, "github_pulls", {
    id: "gp-api",
    repo_id: "r-api",
    number: 9,
    title: "PR",
    state: "open",
    gh_updated_at: 4,
    ...T,
  });
  insert(sql, "services", {
    id: "sv-api",
    agent_id: "a-api",
    pid: 4242,
    port: 5173,
    url: "/p/apollo/a/a-api/port/5173/",
    first_seen_at: 1,
    last_seen_at: 2,
    ...T,
  });

  const workflow = (id: string, specJson: string, extra: Record<string, unknown> = {}) =>
    insert(sql, "workflows", {
      id,
      operation_id: "apollo",
      name: id,
      enabled: 1,
      spec_json: specJson,
      created_by: "u1",
      ...T,
      ...extra,
    });
  workflow("wf-all", spec(PULLS, []));
  workflow("wf-nightly", spec({ kind: "schedule", cron: "0 3 * * *" }, []), {
    last_scheduled_at: 50,
  });
  workflow("wf-api", spec(PULLS, ["r-api"]), { enabled: 0 });
  workflow("wf-web-docs", spec(PULLS, ["r-web", "r-docs"]));
  workflow("wf-broken", "not json");
  insert(sql, "workflow_runs", {
    id: "run-api",
    workflow_id: "wf-api",
    operation_id: "apollo",
    delivery_id: "d-1",
    trigger: "pull_request.opened",
    context_json: "{}",
    status: "succeeded",
    provider: "claude-code",
    day: "2026-10-01",
    queued_at: 10,
    ...T,
  });

  // A shared office agent (#271) granted on apollo and on solo, with a question asked in apollo.
  insert(sql, "office_agents", {
    id: "oa-pm",
    name: "Quillon",
    name_key: "moneypenny",
    engine: "cli-session",
    role: "pm",
    preset: "coordinator",
    provider: "claude-code",
    model: "opus",
    ...T,
  });
  for (const [id, operationId, access] of [
    ["g-apollo", "apollo", "spawn"],
    ["g-solo", "solo", "view"],
  ] as const) {
    insert(sql, "office_agent_grants", {
      id,
      agent_id: "oa-pm",
      operation_id: operationId,
      access,
      ...T,
    });
  }
  insert(sql, "office_agent_requests", {
    id: "q1",
    agent_id: "oa-pm",
    for_user_id: "u2",
    question: "Ship it?",
    operation_id: "apollo",
    ...T,
  });

  insert(sql, "notification_channels", {
    id: "n-some",
    kind: "slack",
    label: "ops",
    encrypted_secret: "v1.secret",
    operation_ids_json: '["apollo","solo"]',
    ...T,
  });
  insert(sql, "notification_channels", {
    id: "n-all",
    kind: "discord",
    label: "all",
    encrypted_secret: "v1.s",
    ...T,
  });

  insert(sql, "whiteboards", { id: "wb", operation_id: "apollo", version: 3, ...T });
  insert(sql, "decor", {
    id: "pic",
    operation_id: "apollo",
    kind: "picture",
    wall_id: "n",
    x: 1,
    y: 2,
    w: 1,
    h: 1,
    ...T,
  });
  insert(sql, "chat_messages", {
    id: "c1",
    user_id: "u2",
    display_name: "U2",
    operation_id: "apollo",
    text: "hi",
    ts: 5,
    ...T,
  });
}

const MIGRATIONS = join(import.meta.dir, "../../drizzle");

/** A copy of the migrations folder under `dir` as it was before migration `tag`. */
export function migrationsBefore(dir: string, tag: string): string {
  const old = join(dir, `drizzle-${tag}`);
  cpSync(MIGRATIONS, old, { recursive: true });
  const journalPath = join(old, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  const at = journal.entries.findIndex((e) => e.tag.endsWith(tag));
  if (at <= 0) throw new Error(`no migration ${tag}`);
  journal.entries = journal.entries.slice(0, at);
  writeFileSync(journalPath, JSON.stringify(journal));
  return old;
}

/** Every file and directory under `root` with its size and mtime. */
export async function tree(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { recursive: true })) {
    const s = await stat(join(root, entry));
    out.push(`${entry} ${s.isDirectory() ? "dir" : s.size} ${s.mtimeMs}`);
  }
  return out.sort();
}
