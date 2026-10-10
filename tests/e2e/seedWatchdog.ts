/**
 * Seed (or remove) a finished watchdog round with findings in the e2e office's own database
 * (#253), run with Bun from tests/e2e/watchdogChecks.ts:
 *
 *   bun tests/e2e/seedWatchdog.ts <office.db> add <tag> | remove <tag>
 *
 * A round is done by the watchdog's model through the office tools, and this office has no
 * runner and makes no outbound call, so what a round leaves behind is written here, for the
 * throwaway office Playwright started: a part for the targets without a room and one for the
 * Apollo room (when there is such a room), with one fault in Apollo with a proposed fix, one
 * dismissed, and one of a target without a room. Rounds themselves
 * are covered with the scripted engine in apps/server/src/pm/watchdog.
 */
import { Database } from "bun:sqlite";

const [path, action, tag] = process.argv.slice(2);
if (!path || !tag || (action !== "add" && action !== "remove")) {
  console.error("usage: seedWatchdog.ts <office.db> add|remove <tag>");
  process.exit(2);
}
const db = new Database(path);
db.run("PRAGMA busy_timeout = 5000");
const roundId = `e2e-round-${tag}`;
if (action === "remove") {
  db.run("DELETE FROM watchdog_findings WHERE round_id = ?", [roundId]);
  db.run("DELETE FROM watchdog_round_parts WHERE round_id = ?", [roundId]);
  db.run("DELETE FROM watchdog_rounds WHERE id = ?", [roundId]);
  db.close();
  process.exit(0);
}

const now = Date.now();
const apollo = db
  .query("SELECT id FROM operations WHERE name = 'Apollo' AND archived_at IS NULL")
  .get() as { id: string } | null;
db.run(
  `INSERT INTO watchdog_rounds (id, trigger, state, started_at, finished_at, created_at, updated_at)
   VALUES (?, 'schedule', 'done', ?, ?, ?, ?)`,
  [roundId, now - 4 * 60_000, now - 3 * 60_000, now, now],
);
// One part per room, each with the watchdog's own words about that room only.
const part = (n: number, operationId: string | null, summary: string) =>
  db.run(
    `INSERT INTO watchdog_round_parts (id, round_id, position, scope, operation_id, state, started_at, checked_at,
       finished_at, summary, marks_json, signals_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'done', ?, ?, ?, ?, '{}', '{}', ?, ?)`,
    [
      `${roundId}-p${n}`,
      roundId,
      n,
      operationId ? "room" : "office",
      operationId,
      now - 4 * 60_000,
      now - 4 * 60_000,
      now - 3 * 60_000,
      summary,
      now,
      now,
    ],
  );
part(0, null, "worker is down.");
if (apollo)
  part(1, apollo.id, "api has a new TypeError in the orders route and a payments timeout.");
const finding = (f: {
  n: number;
  title: string;
  evidence: string;
  disposition: string;
  reason: string;
  room: boolean;
  fixState: string;
  fixSummary: string;
  comment: string;
  sources: Array<{ kind: string; key: string; label: string; url?: string }>;
}) => {
  const id = `e2e-finding-${tag}-${f.n}`;
  const operationId = f.room ? (apollo?.id ?? null) : null;
  db.run(
    `INSERT INTO watchdog_findings (id, title, evidence, disposition, reason, scope, operation_id, round_id,
       judged_at, announced_at, first_seen_at, last_seen_at, seen_count, regressions, fix_state, fix_summary,
       fix_auto, sentry_comment, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 0, ?, ?, ?)`,
    [
      id,
      f.title,
      f.evidence,
      f.disposition,
      f.reason,
      operationId ? "room" : "office",
      operationId,
      roundId,
      now - 4 * 60_000,
      // People were told of it long ago: no toast about it at sign-in.
      now - 8 * 24 * 3_600_000,
      now - 4 * 60_000,
      now - 4 * 60_000,
      operationId ? f.fixState : f.fixState === "none" ? "none" : "unavailable",
      f.fixSummary,
      f.comment,
      now,
      now,
    ],
  );
  for (const [i, s] of f.sources.entries()) {
    db.run(
      `INSERT INTO watchdog_finding_sources (id, finding_id, kind, key, label, url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `${id}-s${i}`,
        id,
        s.kind,
        `${s.key}:${tag}@${operationId ?? "office"}`,
        s.label,
        s.url ?? null,
        now,
        now,
      ],
    );
  }
};
finding({
  n: 1,
  title: "Orders handler reads id of undefined",
  evidence:
    "TypeError: Cannot read properties of undefined (reading 'id')\n    at handler (/srv/app/src/routes/orders.js:42:17)\n14 events in the last hour, first seen after release 41",
  disposition: "propose_fix",
  reason:
    "A missing null check in the orders route: req.user is read before the session is loaded.",
  room: true,
  fixState: "awaiting_approval",
  fixSummary: "Guard req.user before reading id in src/routes/orders.js, with a test.",
  comment: "posted",
  sources: [
    {
      kind: "sentry",
      key: "sentry:acme/WEB-1A",
      label: "WEB-1A",
      url: "https://sentry.io/organizations/acme/issues/1001/",
    },
    { kind: "pm2", key: "pm2:e2e-app:err:0123456789abcdef", label: "api on prod-1" },
  ],
});
finding({
  n: 2,
  title: "Payments upstream timing out",
  evidence: "upstream payments timed out after 3000 ms, password=[redacted]",
  disposition: "dismiss",
  reason: "A known third-party outage; their status page says so.",
  room: true,
  fixState: "none",
  fixSummary: "",
  comment: "none",
  sources: [{ kind: "pm2", key: "pm2:e2e-app:err:fedcba9876543210", label: "api on prod-1" }],
});
finding({
  n: 3,
  title: "worker is down",
  evidence: "worker is errored, not online",
  disposition: "notify",
  reason: "It is errored and PM2 has stopped restarting it.",
  room: false,
  fixState: "none",
  fixSummary: "",
  comment: "none",
  sources: [{ kind: "pm2", key: "pm2:e2e-worker:down:2026-10-09", label: "worker on prod-1" }],
});
db.close();
