/**
 * Seed (or remove) an office-wide key row in the e2e office's own database (#252), run with
 * Bun from tests/e2e/officeAgentWorldChecks.ts:
 *
 *   bun tests/e2e/seedOfficeKey.ts <office.db> add <id> | remove <id>
 *
 * A shared office agent must name an office key, and the office only stores one after
 * checking it with the provider. The e2e makes no outbound call, so the row is written here,
 * for the throwaway office Playwright started. Its "secret" is a placeholder nothing can
 * decrypt: no message is ever sent with it.
 */
import { Database } from "bun:sqlite";

const [path, action, id] = process.argv.slice(2);
if (!path || !id || (action !== "add" && action !== "remove")) {
  console.error("usage: seedOfficeKey.ts <office.db> add|remove <id>");
  process.exit(2);
}
const db = new Database(path);
db.run("PRAGMA busy_timeout = 5000");
if (action === "add") {
  const now = Date.now();
  db.run(
    `INSERT INTO credential_profiles (id, user_id, provider, label, auth_kind, encrypted_secret, created_at, updated_at)
     VALUES (?, NULL, 'claude-code', ?, 'api_key', 'e2e-placeholder-not-a-key', ?, ?)`,
    [id, `E2E office key ${id.slice(0, 8)}`, now, now],
  );
} else db.run("DELETE FROM credential_profiles WHERE id = ? AND user_id IS NULL", [id]);
db.close();
