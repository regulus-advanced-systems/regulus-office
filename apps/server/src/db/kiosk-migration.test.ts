/**
 * The office_agent_kiosks migration (#56). Before it, `kiosk` was a job any
 * office agent could be given as a label: personal or shared, on any engine,
 * with any grants. After it the job means a placed board helper, which an
 * existing row is not. Each such row becomes `custom` and keeps everything
 * else, so it can still change job, keeps its body and is not treated as a
 * helper without a board.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEMORY_DB_PATH, openDatabase, runMigrations } from "./index.ts";

const MIGRATIONS = join(import.meta.dir, "../../drizzle");
const dir = mkdtempSync(join(tmpdir(), "rg56-kiosk-migration-"));
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

describe("office_agent_kiosks migration", () => {
  test("agents that only carried the kiosk label become custom and keep the rest", () => {
    const db = openDatabase({ path: MEMORY_DB_PATH });
    try {
      runMigrations(db, before("_office_agent_kiosks"));
      const c = db.$client;
      c.run(
        "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES ('u1', 'Mia', 'mia@example.com', 0, 1, 1)",
      );
      const agent = (id: string, owner: string | null, engine: string, role: string) =>
        c.run(
          `INSERT INTO office_agents (id, name, name_key, owner_user_id, engine, role, preset, provider, model, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'manager', 'claude-code', 'sonnet', 1, 1)`,
          [id, id, id, owner, engine, role],
        );
      // A personal one on the owner's own Hermes, a shared one, and a PM that is left alone.
      agent("mias-kiosk", "u1", "hermes-external", "kiosk");
      agent("office-kiosk", null, "cli-session", "kiosk");
      agent("number-two", null, "cli-session", "pm");
      runMigrations(db);

      const rows = c
        .query(
          "SELECT id, role, engine, owner_user_id AS owner, preset FROM office_agents ORDER BY id",
        )
        .all();
      expect(rows).toEqual([
        {
          id: "mias-kiosk",
          role: "custom",
          engine: "hermes-external",
          owner: "u1",
          preset: "manager",
        },
        { id: "number-two", role: "pm", engine: "cli-session", owner: null, preset: "manager" },
        {
          id: "office-kiosk",
          role: "custom",
          engine: "cli-session",
          owner: null,
          preset: "manager",
        },
      ]);
      expect(c.query("SELECT count(*) AS n FROM office_agent_kiosks").get()).toEqual({ n: 0 });
      expect(c.query("SELECT count(*) AS n FROM office_agent_task_proposals").get()).toEqual({
        n: 0,
      });
    } finally {
      db.$client.close();
    }
  });
});
