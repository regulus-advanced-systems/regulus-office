import { afterEach, describe, expect, test } from "bun:test";
import type { ChatMessage } from "@regulus/protocol";
import {
  closeDatabase,
  type Db,
  MEMORY_DB_PATH,
  openDatabase,
  runMigrations,
} from "../../db/index.ts";
import { type ChatStore, DrizzleChatStore, MemoryChatStore } from "./store.ts";

const opened: Db[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) closeDatabase(db);
});

function drizzleStore(retention: number): DrizzleChatStore {
  const db = openDatabase({ path: MEMORY_DB_PATH });
  runMigrations(db);
  opened.push(db);
  return new DrizzleChatStore(db, retention);
}

const line = (n: number): ChatMessage => ({
  id: `m${String(n).padStart(4, "0")}`,
  userId: "u1",
  displayName: "Ada",
  operationId: "lobby",
  text: `line ${n}`,
  ts: 1_700_000_000_000 + n,
});

const suites: [string, (retention: number) => ChatStore][] = [
  ["DrizzleChatStore", drizzleStore],
  ["MemoryChatStore", (retention) => new MemoryChatStore(retention)],
];

describe.each(suites)("%s", (_name, make) => {
  test("returns the newest lines oldest-first and round-trips fields", async () => {
    const store = make(1000);
    for (let n = 1; n <= 5; n++) await store.append(line(n));
    const recent = await store.recent(3);
    expect(recent.map((m) => m.text)).toEqual(["line 3", "line 4", "line 5"]);
    expect(recent[0]).toEqual(line(3));
  });

  test("keeps only the retention window", async () => {
    const store = make(10);
    for (let n = 1; n <= 25; n++) await store.append(line(n));
    const all = await store.recent(100);
    expect(all).toHaveLength(10);
    expect(all[0]?.text).toBe("line 16");
    expect(all.at(-1)?.text).toBe("line 25");
  });

  test("recent on an empty store is empty", async () => {
    expect(await make(10).recent(50)).toEqual([]);
  });
});
