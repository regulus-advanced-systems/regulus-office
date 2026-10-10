/**
 * Seed a board helper's task proposal in the e2e office's own database (#56), run with Bun
 * from tests/e2e/kioskChecks.ts:
 *
 *   bun tests/e2e/seedProposal.ts <office.db> <proposalId> <agentId> <userId> <operationId>
 *
 * A proposal is made by a helper's `enqueue_task` during a turn. The e2e office has no runner,
 * so no turn runs there; the row a turn would have stored is written here instead, for the
 * throwaway office Playwright started. How a helper makes one, and what confirming does, is
 * covered in apps/server/src/pm/kiosk/kiosk.test.ts.
 */
import { Database } from "bun:sqlite";

const [path, id, agentId, userId, operationId] = process.argv.slice(2);
if (!path || !id || !agentId || !userId || !operationId) {
  console.error("usage: seedProposal.ts <office.db> <proposalId> <agentId> <userId> <operationId>");
  process.exit(2);
}
const db = new Database(path);
db.run("PRAGMA busy_timeout = 5000");
const repo = db
  .query("SELECT id FROM operation_repos WHERE operation_id = ? LIMIT 1")
  .get(operationId) as { id: string } | null;
if (!repo) {
  console.error("that operation has no repo");
  process.exit(1);
}
const now = Date.now();
const task = {
  operationId,
  repoId: repo.id,
  kind: "freeform",
  title: "Tidy the README",
  prompt:
    "Read README.md and fix the three broken links in the Quickstart section.\nDo not change anything else. Open a pull request when done.",
  provider: "claude-code",
  model: "sonnet",
};
db.run(
  `INSERT INTO office_agent_task_proposals
     (id, agent_id, for_user_id, operation_id, input_json, status, expires_at, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  [id, agentId, userId, operationId, JSON.stringify(task), now + 14 * 60_000, now, now],
);
db.close();
