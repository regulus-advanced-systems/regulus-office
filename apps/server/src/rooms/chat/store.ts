/**
 * Chat persistence for the BuildingRoom: the server keeps the last
 * `CHAT_RETENTION` lines (SPEC §6 channel 1, "chat") and replays the last
 * `CHAT_REPLAY` to a joining client through room state.
 */
import type { ChatMessage } from "@regulus/protocol";
import { asc, desc, inArray, sql } from "drizzle-orm";
import { chatMessages, type Db } from "../../db/index.ts";

/** Lines kept in the database. */
export const CHAT_RETENTION = 1000;
/** Lines present in room state, i.e. replayed to a joining client. */
export const CHAT_REPLAY = 50;

export interface ChatStore {
  /** Persist one line and drop the oldest beyond the retention window. */
  append(message: ChatMessage): Promise<void>;
  /** The newest `limit` lines, oldest first. */
  recent(limit: number): Promise<ChatMessage[]>;
}

/** Drizzle-backed store; `retention` is overridable for tests. */
export class DrizzleChatStore implements ChatStore {
  readonly #db: Db;
  readonly #retention: number;

  constructor(db: Db, retention: number = CHAT_RETENTION) {
    this.#db = db;
    this.#retention = retention;
  }

  async append(message: ChatMessage): Promise<void> {
    await this.#db.insert(chatMessages).values({
      id: message.id,
      userId: message.userId,
      displayName: message.displayName,
      operationId: message.operationId,
      text: message.text,
      ts: new Date(message.ts),
    });
    await this.#trim();
  }

  async recent(limit: number): Promise<ChatMessage[]> {
    const rows = await this.#db
      .select()
      .from(chatMessages)
      .orderBy(desc(chatMessages.ts), desc(chatMessages.id))
      .limit(limit);
    return rows.reverse().map((row) => ({
      id: row.id,
      userId: row.userId,
      displayName: row.displayName,
      operationId: row.operationId,
      text: row.text,
      ts: row.ts.getTime(),
    }));
  }

  async #trim(): Promise<void> {
    const [row] = await this.#db.select({ n: sql<number>`count(*)` }).from(chatMessages);
    const excess = (row?.n ?? 0) - this.#retention;
    if (excess <= 0) return;
    const oldest = this.#db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .orderBy(asc(chatMessages.ts), asc(chatMessages.id))
      .limit(excess);
    await this.#db.delete(chatMessages).where(inArray(chatMessages.id, oldest));
  }
}

/** In-memory store for unit tests and the load-test script. */
export class MemoryChatStore implements ChatStore {
  readonly lines: ChatMessage[] = [];
  readonly #retention: number;

  constructor(retention: number = CHAT_RETENTION) {
    this.#retention = retention;
  }

  async append(message: ChatMessage): Promise<void> {
    this.lines.push(message);
    if (this.lines.length > this.#retention)
      this.lines.splice(0, this.lines.length - this.#retention);
  }

  async recent(limit: number): Promise<ChatMessage[]> {
    return this.lines.slice(-limit);
  }
}
