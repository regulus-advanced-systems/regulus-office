/**
 * Incremental indexing for search (#41).
 *
 * - Chat: lines newer than the stored watermark are added (ANSI stripped,
 *   secrets scrubbed); chat retention deletes flow through the
 *   `search_chat_gone` trigger, so the index holds at most the 1000 lines
 *   the chat keeps.
 * - Scrollback: the snapshot files under `<dataDir>/terminals/scrollback`
 *   are scanned; a file whose mtime and size are unchanged is skipped, a
 *   changed one is chunked and diffed against the agent's rows (chunks.ts).
 *   Only live robots (an `agents` row without `exited_at`) are indexed; a
 *   robot that exits, is removed or loses its file loses its rows on the next
 *   sync. The index thus mirrors the snapshots it came from: at most one
 *   1 MiB snapshot per live robot. Login terminals (`login-…`, #32) never
 *   have snapshots and are refused here as well.
 */
import type { Database } from "bun:sqlite";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { LOBBY_FLOOR_ID } from "@regulus/protocol";
import type { Db } from "../db/index.ts";
import type { Logger } from "../logging.ts";
import { isLoginTerminalId } from "../terminals/login-sessions.ts";
import { capTail, SCROLLBACK_MAX_BYTES } from "../terminals/scrollback.ts";
import { AGENT_ID_PATTERN } from "../terminals/targets.ts";
import { chunkScrollback } from "./chunks.ts";
import { ensureSearchSchema, getMeta, setMeta } from "./schema.ts";
import { indexableText } from "./text.ts";

export const INDEX_INTERVAL_MS = 15_000;
/** Chat lines re-checked behind the watermark (same-millisecond lines, clock skew). */
const CHAT_OVERLAP_MS = 5_000;
const CHAT_BATCH = 500;

export interface SearchIndexerOptions {
  db: Db;
  /** Where terminals/scrollback.ts writes `<agentId>.txt`. */
  scrollbackDir: string;
  logger: Logger;
  intervalMs?: number;
  now?: () => number;
}

interface ChatRow {
  id: string;
  display_name: string;
  floor_id: string;
  text: string;
  ts: number;
}

/** The floor a chat line counts for; building-wide lines belong to the lobby. */
export function chatFloor(floorId: string): string {
  return floorId === "" ? LOBBY_FLOOR_ID : floorId;
}

export class SearchIndexer {
  readonly #client: Database;
  readonly #dir: string;
  readonly #logger: Logger;
  readonly #intervalMs: number;
  readonly #now: () => number;
  #timer: ReturnType<typeof setInterval> | undefined;
  #running: Promise<void> = Promise.resolve();

  constructor(options: SearchIndexerOptions) {
    this.#client = options.db.$client;
    this.#dir = options.scrollbackDir;
    this.#logger = options.logger;
    this.#intervalMs = options.intervalMs ?? INDEX_INTERVAL_MS;
    this.#now = options.now ?? Date.now;
    ensureSearchSchema(this.#client);
    // Lines deleted while the trigger did not exist yet (first boot, a rebuilt index).
    this.#client.run(
      "DELETE FROM search_docs WHERE kind = 'chat' AND source_id NOT IN (SELECT id FROM chat_messages)",
    );
  }

  /** Index chat lines newer than the watermark; returns how many were added. */
  syncChat(): number {
    const client = this.#client;
    let added = 0;
    const exists = client.query<{ n: number }, [string]>(
      "SELECT count(*) AS n FROM search_docs WHERE kind = 'chat' AND source_id = ?",
    );
    const insert = client.query(
      `INSERT INTO search_docs (kind, source_id, floor_id, ts, author, body)
       VALUES ('chat', ?, ?, ?, ?, ?)`,
    );
    const select = client.query<ChatRow, [number, number, string]>(
      `SELECT id, display_name, floor_id, text, ts FROM chat_messages
       WHERE ts > ? OR (ts = ? AND id > ?) ORDER BY ts, id LIMIT ${CHAT_BATCH}`,
    );
    let mark = Number(getMeta(client, "chat_ts") ?? "0") - CHAT_OVERLAP_MS;
    let markId = "";
    for (;;) {
      const rows = select.all(mark, mark, markId);
      if (rows.length === 0) break;
      client.transaction(() => {
        for (const row of rows) {
          if (exists.get(row.id)?.n) continue;
          insert.run(
            row.id,
            chatFloor(row.floor_id),
            row.ts,
            row.display_name,
            indexableText(row.text),
          );
          added += 1;
        }
      })();
      const last = rows.at(-1) as ChatRow;
      mark = last.ts;
      markId = last.id;
      setMeta(client, "chat_ts", String(last.ts));
      if (rows.length < CHAT_BATCH) break;
    }
    return added;
  }

  /**
   * Replace an agent's scrollback rows with the chunks of `text`, touching
   * only chunks that changed. `ts` stamps new chunks.
   */
  indexSnapshot(agentId: string, floorId: string, text: string, ts: number = this.#now()): void {
    if (!AGENT_ID_PATTERN.test(agentId) || isLoginTerminalId(agentId)) return;
    const chunks = chunkScrollback(indexableText(text));
    const wanted = new Map<string, { seq: number; body: string }>();
    chunks.forEach((c, seq) => wanted.set(c.hash, { seq, body: c.body }));
    const client = this.#client;
    const existing = client
      .query<{ id: number; hash: string }, [string]>(
        "SELECT id, hash FROM search_docs WHERE kind = 'scrollback' AND source_id = ?",
      )
      .all(agentId);
    const del = client.query("DELETE FROM search_docs WHERE id = ?");
    const upd = client.query("UPDATE search_docs SET seq = ?, floor_id = ? WHERE id = ?");
    const ins = client.query(
      `INSERT INTO search_docs (kind, source_id, floor_id, ts, seq, hash, body)
       VALUES ('scrollback', ?, ?, ?, ?, ?, ?)`,
    );
    client.transaction(() => {
      const kept = new Set<string>();
      for (const row of existing) {
        const want = wanted.get(row.hash);
        if (!want || kept.has(row.hash)) {
          del.run(row.id);
          continue;
        }
        kept.add(row.hash);
        upd.run(want.seq, floorId, row.id);
      }
      for (const [hash, want] of wanted) {
        if (!kept.has(hash)) ins.run(agentId, floorId, ts, want.seq, hash, want.body);
      }
    })();
  }

  /** Drop an agent's scrollback rows (exited, removed, file gone). */
  forget(agentId: string): void {
    this.#client.transaction(() => {
      this.#client.run("DELETE FROM search_docs WHERE kind = 'scrollback' AND source_id = ?", [
        agentId,
      ]);
      this.#client.run("DELETE FROM search_sources WHERE agent_id = ?", [agentId]);
    })();
  }

  /** Scan the snapshot directory and bring the scrollback rows up to date. */
  async syncScrollback(): Promise<void> {
    const client = this.#client;
    const live = new Map(
      client
        .query<{ id: string; floor_id: string }, []>(
          "SELECT id, floor_id FROM agents WHERE exited_at IS NULL",
        )
        .all()
        .map((r) => [r.id, r.floor_id]),
    );
    let names: string[] = [];
    try {
      names = await readdir(this.#dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const seen = new Set<string>();
    const sources = client.query<{ mtime_ms: number; size: number }, [string]>(
      "SELECT mtime_ms, size FROM search_sources WHERE agent_id = ?",
    );
    for (const name of names) {
      if (!name.endsWith(".txt")) continue;
      const agentId = name.slice(0, -4);
      const floorId = live.get(agentId);
      if (!floorId || !AGENT_ID_PATTERN.test(agentId) || isLoginTerminalId(agentId)) continue;
      seen.add(agentId);
      const path = join(this.#dir, name);
      try {
        const info = await stat(path);
        const mtime = Math.trunc(info.mtimeMs);
        const known = sources.get(agentId);
        if (known && known.mtime_ms === mtime && known.size === info.size) continue;
        const text = capTail(await readFile(path, "utf8"), SCROLLBACK_MAX_BYTES);
        this.indexSnapshot(agentId, floorId, text, mtime);
        client.run(
          "INSERT OR REPLACE INTO search_sources (agent_id, mtime_ms, size) VALUES (?, ?, ?)",
          [agentId, mtime, info.size],
        );
      } catch (err) {
        this.#logger.debug({ err, agentId }, "scrollback indexing failed");
      }
    }
    const indexed = client
      .query<{ id: string }, []>(
        `SELECT DISTINCT source_id AS id FROM search_docs WHERE kind = 'scrollback'
         UNION SELECT agent_id AS id FROM search_sources`,
      )
      .all();
    for (const { id } of indexed) if (!seen.has(id)) this.forget(id);
  }

  /** One full pass (chat, then scrollback); passes never overlap. */
  sync(): Promise<void> {
    this.#running = this.#running.then(async () => {
      try {
        this.syncChat();
        await this.syncScrollback();
      } catch (err) {
        this.#logger.warn({ err }, "search indexing failed");
      }
    });
    return this.#running;
  }

  start(): void {
    if (this.#timer) return;
    void this.sync();
    this.#timer = setInterval(() => void this.sync(), this.#intervalMs);
    this.#timer.unref?.();
  }

  async stop(): Promise<void> {
    clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#running;
  }
}
