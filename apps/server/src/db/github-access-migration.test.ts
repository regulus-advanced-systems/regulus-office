/**
 * The github_access migration (#267): besides the new tables, GitHub sign-in
 * tokens Better Auth had stored in clear are removed; nothing else in
 * `accounts` changes.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "./index.ts";

const MIGRATIONS = join(import.meta.dir, "../../drizzle");
const dir = mkdtempSync(join(tmpdir(), "rg267-access-migration-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The migrations folder as it was before the migration whose tag ends with `tag`. */
function before(tag: string): string {
  const old = join(dir, "drizzle-before");
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

describe("github_access migration", () => {
  test("clear GitHub sign-in tokens are removed; passwords and other rows stay", () => {
    const db = openDatabase({ path: MEMORY_DB_PATH });
    try {
      runMigrations(db, before("_github_access"));
      const c = db.$client;
      c.run(
        "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'Mia', 'mia@example.com', 0, 1, 1)",
      );
      c.run(
        `INSERT INTO accounts (id, account_id, provider_id, user_id, access_token, refresh_token, id_token, scope, created_at, updated_at)
         VALUES ('a1', '1001', 'github', 'u1', 'gho_clearSignInToken0123456789', 'ghr_clearRefresh0123456789', 'idtok', 'read:user', 1, 1)`,
      );
      c.run(
        `INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
         VALUES ('a2', 'u1', 'credential', 'u1', 'hash:abc', 1, 1)`,
      );
      runMigrations(db);

      const rows = c.query("SELECT * FROM accounts ORDER BY id").all() as Record<string, unknown>[];
      expect(rows[0]).toMatchObject({
        id: "a1",
        account_id: "1001",
        provider_id: "github",
        access_token: null,
        refresh_token: null,
        id_token: null,
        scope: "read:user",
      });
      expect(rows[1]).toMatchObject({ id: "a2", provider_id: "credential", password: "hash:abc" });
      expect(JSON.stringify(rows)).not.toContain("gho_");
      for (const table of [
        "github_user_links",
        "github_repo_permissions",
        "github_org_memberships",
      ]) {
        expect(c.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
      }
    } finally {
      db.$client.close();
    }
  });
});
