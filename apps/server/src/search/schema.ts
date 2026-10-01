/**
 * The search index tables (#41). The index is derived data: it can be
 * dropped at any time and is rebuilt from `chat_messages` and the scrollback
 * snapshots on disk. It is therefore created here at boot, not by a drizzle
 * migration, and it is SQLite-only (FTS5); a Postgres port would swap this
 * module for tsvector/pg_trgm without touching the relational schema.
 *
 * - `search_docs`: one row per indexed text (a chat line, or one chunk of a
 *   henchman's scrollback), with what the ACL needs (`kind`, `source_id` =
 *   message or agent id, `operation_id`).
 * - `search_fts`: FTS5 over `search_docs.body` (external content), kept in
 *   step by triggers.
 * - `search_sources`: which scrollback snapshot state each agent's rows
 *   reflect (file mtime and size), so unchanged files are skipped.
 * - `search_meta`: the chat watermark and the schema version.
 * - A trigger on `chat_messages` drops a line's row when chat retention
 *   deletes it, so the index never outlives the chat it came from.
 */
import type { Database } from "bun:sqlite";

/** Bump to drop and rebuild the index on the next boot. */
export const SEARCH_SCHEMA_VERSION = "1";

const TABLES = ["search_sources", "search_meta", "search_fts", "search_docs"] as const;

const CREATE = [
  `CREATE TABLE IF NOT EXISTS search_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS search_docs (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('chat', 'scrollback')),
    source_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0,
    hash TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS search_docs_source_idx ON search_docs (kind, source_id, seq)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
    body, content='search_docs', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
  )`,
  `CREATE TRIGGER IF NOT EXISTS search_docs_ai AFTER INSERT ON search_docs BEGIN
    INSERT INTO search_fts(rowid, body) VALUES (new.id, new.body);
  END`,
  `CREATE TRIGGER IF NOT EXISTS search_docs_ad AFTER DELETE ON search_docs BEGIN
    INSERT INTO search_fts(search_fts, rowid, body) VALUES ('delete', old.id, old.body);
  END`,
  `CREATE TRIGGER IF NOT EXISTS search_docs_au AFTER UPDATE OF body ON search_docs BEGIN
    INSERT INTO search_fts(search_fts, rowid, body) VALUES ('delete', old.id, old.body);
    INSERT INTO search_fts(rowid, body) VALUES (new.id, new.body);
  END`,
  `CREATE TABLE IF NOT EXISTS search_sources (
    agent_id TEXT PRIMARY KEY,
    mtime_ms INTEGER NOT NULL,
    size INTEGER NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS search_chat_gone AFTER DELETE ON chat_messages BEGIN
    DELETE FROM search_docs WHERE kind = 'chat' AND source_id = old.id;
  END`,
];

function drop(client: Database): void {
  client.run("DROP TRIGGER IF EXISTS search_chat_gone");
  for (const table of TABLES) client.run(`DROP TABLE IF EXISTS ${table}`);
}

/** Create the index tables (dropping an index of another version first). */
export function ensureSearchSchema(client: Database): void {
  client.transaction(() => {
    const hasMeta = client
      .query<{ n: number }, []>(
        "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'search_meta'",
      )
      .get();
    if (hasMeta?.n) {
      const row = client
        .query<{ value: string }, []>("SELECT value FROM search_meta WHERE key = 'version'")
        .get();
      if (row?.value !== SEARCH_SCHEMA_VERSION) drop(client);
    }
    for (const statement of CREATE) client.run(statement);
    client.run("INSERT OR REPLACE INTO search_meta (key, value) VALUES ('version', ?)", [
      SEARCH_SCHEMA_VERSION,
    ]);
  })();
}

export function getMeta(client: Database, key: string): string | null {
  return (
    client
      .query<{ value: string }, [string]>("SELECT value FROM search_meta WHERE key = ?")
      .get(key)?.value ?? null
  );
}

export function setMeta(client: Database, key: string, value: string): void {
  client.run("INSERT OR REPLACE INTO search_meta (key, value) VALUES (?, ?)", [key, value]);
}
