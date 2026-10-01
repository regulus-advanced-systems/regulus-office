import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { chatMessages } from "../db/schema/index.ts";
import { testDb } from "../operations/test-helpers.ts";
import { chunkScrollback } from "./chunks.ts";
import { ensureSearchSchema, SEARCH_SCHEMA_VERSION } from "./schema.ts";
import {
  addChat,
  addHenchman,
  addOperation,
  docCount,
  exitHenchman,
  indexerFor,
  tempDir,
} from "./testing.ts";

let env: ReturnType<typeof testDb>;
let tmp: ReturnType<typeof tempDir>;

beforeEach(() => {
  env = testDb();
  tmp = tempDir();
  addOperation(env.db, "f1");
  const owner = env.addUser("Rob", "member");
  addHenchman(env.db, "a1", "f1", owner.id);
  addHenchman(env.db, "a2", "f1", owner.id);
});
afterEach(() => tmp.cleanup());

const bodies = (sourceId: string) =>
  env.db.$client
    .query<{ body: string; seq: number; id: number }, [string]>(
      "SELECT id, body, seq FROM search_docs WHERE source_id = ? ORDER BY seq",
    )
    .all(sourceId);

const lines = (from: number, to: number, tag = "line") =>
  Array.from({ length: to - from }, (_, i) => `${tag} ${from + i} output text`).join("\n");

describe("chat indexing", () => {
  test("new lines are indexed once, ANSI stripped and secrets scrubbed", () => {
    const indexer = indexerFor(env.db, tmp.dir);
    addChat(env.db, "\x1b[31mdeploy\x1b[0m is green");
    addChat(env.db, "my key is sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA", "f1");
    expect(indexer.syncChat()).toBe(2);
    expect(indexer.syncChat()).toBe(0);
    const rows = env.db.$client
      .query<{ body: string; operation_id: string }, []>(
        "SELECT body, operation_id FROM search_docs WHERE kind = 'chat' ORDER BY id",
      )
      .all();
    expect(rows).toEqual([
      { body: "deploy is green", operation_id: "lobby" },
      { body: "my key is [redacted]", operation_id: "f1" },
    ]);
  });

  test("lines in the same millisecond as the watermark are not missed", () => {
    const indexer = indexerFor(env.db, tmp.dir);
    const ts = Date.now();
    addChat(env.db, "first", "", ts);
    indexer.syncChat();
    addChat(env.db, "second", "", ts);
    expect(indexer.syncChat()).toBe(1);
    expect(docCount(env.db, "chat")).toBe(2);
  });

  test("chat retention deletes flow into the index (trigger)", () => {
    const indexer = indexerFor(env.db, tmp.dir);
    const id = addChat(env.db, "short lived");
    indexer.syncChat();
    expect(docCount(env.db, "chat", id)).toBe(1);
    env.db.delete(chatMessages).where(eq(chatMessages.id, id)).run();
    expect(docCount(env.db, "chat", id)).toBe(0);
    expect(
      env.db.$client.query("SELECT rowid FROM search_fts WHERE search_fts MATCH 'lived'").all(),
    ).toHaveLength(0);
  });
});

describe("scrollback indexing", () => {
  const snapshot = (agentId: string, text: string, mtime: number) => {
    const path = join(tmp.dir, `${agentId}.txt`);
    writeFileSync(path, text);
    utimesSync(path, mtime, mtime);
  };

  test("a changed snapshot only touches the chunks that changed", () => {
    const indexer = indexerFor(env.db, tmp.dir);
    const v1 = lines(0, 400);
    indexer.indexSnapshot("a1", "f1", v1, 1000);
    const before = bodies("a1");
    expect(before.length).toBe(chunkScrollback(v1).length);

    // 50 new lines at the bottom, 50 old ones fell off the top.
    const v2 = lines(50, 450);
    indexer.indexSnapshot("a1", "f1", v2, 2000);
    const after = bodies("a1");
    const beforeIds = new Set(before.map((r) => r.id));
    const keptRows = after.filter((r) => beforeIds.has(r.id));
    // Most rows survive untouched (same id), and the index text equals the new snapshot.
    expect(keptRows.length).toBeGreaterThan(before.length / 2);
    expect(after.map((r) => r.body).join("\n")).toBe(
      chunkScrollback(v2)
        .map((c) => c.body)
        .join("\n"),
    );
    const stamped = env.db.$client
      .query<{ ts: number }, []>(
        "SELECT DISTINCT ts FROM search_docs WHERE source_id = 'a1' ORDER BY ts",
      )
      .all()
      .map((r) => r.ts);
    expect(stamped).toEqual([1000, 2000]);
  });

  test("the index strips ANSI and secrets from snapshots", () => {
    const indexer = indexerFor(env.db, tmp.dir);
    indexer.indexSnapshot(
      "a1",
      "f1",
      "\x1b[1mBuild\x1b[0m ok\nGITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123",
      1,
    );
    const text = bodies("a1")
      .map((r) => r.body)
      .join("\n");
    expect(text).toBe("Build ok\nGITHUB_TOKEN=[redacted]");
  });

  test("sync reads files, skips unchanged ones, and forgets exited henchmen", async () => {
    const indexer = indexerFor(env.db, tmp.dir);
    snapshot("a1", "hello from a1", 1_700_000_000);
    snapshot("a2", "hello from a2", 1_700_000_000);
    await indexer.syncScrollback();
    expect(docCount(env.db, "scrollback", "a1")).toBe(1);
    expect(docCount(env.db, "scrollback", "a2")).toBe(1);

    // Unchanged mtime and size: the file is not read again (a changed body would show).
    const id = bodies("a1")[0]?.id;
    await indexer.syncScrollback();
    expect(bodies("a1")[0]?.id).toBe(id);

    snapshot("a1", "a1 moved on to new work", 1_700_000_100);
    await indexer.syncScrollback();
    expect(bodies("a1").map((r) => r.body)).toEqual(["a1 moved on to new work"]);

    exitHenchman(env.db, "a2");
    await indexer.syncScrollback();
    expect(docCount(env.db, "scrollback", "a2")).toBe(0);
  });

  test("files of unknown agents and login terminals are never indexed", async () => {
    const indexer = indexerFor(env.db, tmp.dir);
    snapshot("login-abc", "paste your code: 4/0AbCdEf", 1_700_000_000);
    snapshot("ghost", "no such henchman", 1_700_000_000);
    snapshot("../evil", "x", 1_700_000_000);
    indexer.indexSnapshot("login-abc", "f1", "direct call", 1);
    await indexer.syncScrollback();
    expect(docCount(env.db, "scrollback")).toBe(0);
  });

  test("a missing directory is not an error; a vanished file drops its rows", async () => {
    const indexer = indexerFor(env.db, join(tmp.dir, "nope"));
    await indexer.syncScrollback();
    const dir = join(tmp.dir, "nope");
    mkdirSync(dir);
    writeFileSync(join(dir, "a1.txt"), "text");
    await indexer.syncScrollback();
    expect(docCount(env.db, "scrollback", "a1")).toBe(1);
    const other = indexerFor(env.db, tmp.dir); // a directory without a1.txt
    await other.syncScrollback();
    expect(docCount(env.db, "scrollback", "a1")).toBe(0);
  });
});

describe("schema", () => {
  test("idempotent, and a version change rebuilds the index", () => {
    const client = env.db.$client;
    ensureSearchSchema(client);
    ensureSearchSchema(client);
    const indexer = indexerFor(env.db, tmp.dir);
    addChat(env.db, "persisted line");
    indexer.syncChat();
    expect(docCount(env.db, "chat")).toBe(1);
    client.run("UPDATE search_meta SET value = 'old' WHERE key = 'version'");
    ensureSearchSchema(client);
    expect(docCount(env.db, "chat")).toBe(0);
    expect(
      client
        .query<{ value: string }, []>("SELECT value FROM search_meta WHERE key = 'version'")
        .get()?.value,
    ).toBe(SEARCH_SCHEMA_VERSION);
    // The rebuilt index fills again from chat_messages.
    indexerFor(env.db, tmp.dir).syncChat();
    expect(docCount(env.db, "chat")).toBe(1);
  });

  test("an index from before #226 (version 1, floor_id) is rebuilt with operation_id", () => {
    const client = env.db.$client;
    client.run("DROP TRIGGER IF EXISTS search_chat_gone");
    for (const t of ["search_sources", "search_meta", "search_fts", "search_docs"])
      client.run(`DROP TABLE IF EXISTS ${t}`);
    client.run("CREATE TABLE search_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    client.run("INSERT INTO search_meta (key, value) VALUES ('version', '1')");
    client.run(
      "CREATE TABLE search_docs (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, source_id TEXT NOT NULL, floor_id TEXT NOT NULL, ts INTEGER NOT NULL, body TEXT NOT NULL)",
    );
    ensureSearchSchema(client);
    const cols = client.query<{ name: string }, []>("PRAGMA table_info(search_docs)").all();
    expect(cols.map((c) => c.name)).toContain("operation_id");
    addChat(env.db, "after the upgrade");
    indexerFor(env.db, tmp.dir).syncChat();
    expect(docCount(env.db, "chat")).toBeGreaterThan(0);
  });
});
