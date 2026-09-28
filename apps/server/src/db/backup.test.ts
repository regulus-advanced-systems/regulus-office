import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { closeDatabase, databasePathFor, openDatabase, runMigrations, schema } from "./index.ts";

const SCRIPT = resolve(import.meta.dir, "../../../../scripts/backup.sh");
const hasSqlite3 = Bun.which("sqlite3") !== null;

describe.skipIf(!hasSqlite3)("scripts/backup.sh", () => {
  test("writes a timestamped consistent copy and prunes old backups", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "office-backup-"));
    try {
      const db = openDatabase({ path: databasePathFor(dataDir) });
      runMigrations(db);
      await db.insert(schema.users).values({ name: "A", email: "a@example.com" });
      // Leave the connection open: .backup must work against a live WAL database.

      const backupDir = join(dataDir, "backups");
      const stale = join(backupDir, "office-20000101-000000.db");
      Bun.spawnSync(["mkdir", "-p", backupDir]);
      writeFileSync(stale, "");
      const old = new Date(Date.now() - 30 * 86_400_000);
      utimesSync(stale, old, old);

      const proc = Bun.spawnSync([SCRIPT], {
        env: { ...process.env, OFFICE_DATA_DIR: dataDir, OFFICE_BACKUP_RETENTION_DAYS: "7" },
      });
      const out = proc.stdout.toString();
      expect(proc.exitCode, proc.stderr.toString()).toBe(0);
      expect(out).toMatch(/backup: wrote .*office-\d{8}-\d{6}\.db/);
      expect(out).toContain("pruned");
      closeDatabase(db);

      const files = readdirSync(backupDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^office-\d{8}-\d{6}\.db$/);
      const copy = openDatabase({ path: join(backupDir, files[0] as string) });
      expect(await copy.select().from(schema.users)).toHaveLength(1);
      closeDatabase(copy);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("fails clearly when the database is missing", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "office-backup-"));
    try {
      const proc = Bun.spawnSync([SCRIPT], { env: { ...process.env, OFFICE_DATA_DIR: dataDir } });
      expect(proc.exitCode).toBe(1);
      expect(proc.stderr.toString()).toContain("database not found");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
