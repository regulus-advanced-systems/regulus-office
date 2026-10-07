/**
 * Workflows of an operation that is split into one room per repo (#268; see
 * one-repo-per-room.ts). A workflow names the repos it is for in
 * `spec.filters.repoIds`; an empty list meant "every repo of the operation"
 * (for a schedule: the primary repo only). After the split each room has one
 * repo, so every workflow ends up in the rooms whose repo it was for:
 *
 * - empty list: it stays on the original operation and, unless it is a
 *   schedule, each new room gets a copy;
 * - a list with the kept repo: it stays, narrowed to that repo, and each new
 *   room whose repo is listed gets a copy narrowed to its repo;
 * - a list without the kept repo: it moves (with its run history) to the
 *   first new room whose repo is listed, and the other listed rooms get copies.
 *
 * Copies keep the name, the `enabled` flag and the last schedule slot, and
 * start with an empty run history. A spec that cannot be read is left alone.
 */
import type { Database } from "bun:sqlite";

interface WorkflowRow {
  id: string;
  name: string;
  enabled: number;
  spec_json: string;
  last_scheduled_at: number | null;
  created_by: string | null;
}

interface Spec {
  trigger?: { kind?: unknown };
  filters?: { repoIds?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

function parseSpec(json: string): Spec | null {
  try {
    const spec = JSON.parse(json) as unknown;
    return spec && typeof spec === "object" && !Array.isArray(spec) ? (spec as Spec) : null;
  } catch {
    return null;
  }
}

const withRepos = (spec: Spec, repoIds: string[]): string =>
  JSON.stringify({ ...spec, filters: { ...(spec.filters ?? {}), repoIds } });

export function splitWorkflows(
  sql: Database,
  fromOperationId: string,
  keptRepoId: string,
  rooms: ReadonlyArray<{ operationId: string; repoId: string }>,
  now: number,
): void {
  const tables = sql
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('workflows', 'workflow_runs')",
    )
    .all() as Array<{ name: string }>;
  if (!tables.some((t) => t.name === "workflows")) return;
  const hasRuns = tables.some((t) => t.name === "workflow_runs");
  const rows = sql
    .query(
      `SELECT id, name, enabled, spec_json, last_scheduled_at, created_by FROM workflows
       WHERE operation_id = ? ORDER BY rowid`,
    )
    .all(fromOperationId) as WorkflowRow[];

  const copyTo = (row: WorkflowRow, operationId: string, specJson: string) => {
    sql
      .query(
        `INSERT INTO workflows (id, operation_id, name, enabled, spec_json, last_scheduled_at,
           created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        operationId,
        row.name,
        row.enabled,
        specJson,
        row.last_scheduled_at,
        row.created_by,
        now,
        now,
      );
  };
  const setSpec = (row: WorkflowRow, specJson: string) => {
    sql
      .query("UPDATE workflows SET spec_json = ?, updated_at = ? WHERE id = ?")
      .run(specJson, now, row.id);
  };

  for (const row of rows) {
    const spec = parseSpec(row.spec_json);
    if (!spec) continue;
    const listed = Array.isArray(spec.filters?.repoIds)
      ? spec.filters.repoIds.filter((id): id is string => typeof id === "string")
      : [];
    if (listed.length === 0) {
      if (spec.trigger?.kind === "schedule") continue;
      for (const room of rooms) copyTo(row, room.operationId, row.spec_json);
      continue;
    }
    const targets = rooms.filter((room) => listed.includes(room.repoId));
    if (listed.includes(keptRepoId)) {
      setSpec(row, withRepos(spec, [keptRepoId]));
      for (const room of targets) copyTo(row, room.operationId, withRepos(spec, [room.repoId]));
      continue;
    }
    const [first, ...rest] = targets;
    if (!first) continue;
    sql
      .query("UPDATE workflows SET operation_id = ?, spec_json = ?, updated_at = ? WHERE id = ?")
      .run(first.operationId, withRepos(spec, [first.repoId]), now, row.id);
    if (hasRuns) {
      sql
        .query("UPDATE workflow_runs SET operation_id = ?, updated_at = ? WHERE workflow_id = ?")
        .run(first.operationId, now, row.id);
    }
    for (const room of rest) copyTo(row, room.operationId, withRepos(spec, [room.repoId]));
  }
}
