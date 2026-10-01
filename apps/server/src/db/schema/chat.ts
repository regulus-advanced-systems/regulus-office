/**
 * Building chat history (SPEC §6 channel 1). Not a SPEC §5 table: the room
 * keeps the last 50 lines in shared state and replays them on join, and the
 * server keeps the last 1000 here so history survives restarts.
 *
 * `userId` is informational and deliberately not a foreign key: chat lines
 * outlive deleted accounts, and development sessions authenticate users that
 * have no `users` row.
 */
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { id, timestampMs, timestamps } from "./_columns.ts";

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: id(),
    userId: text("user_id").notNull(),
    displayName: text("display_name").notNull(),
    /** Operation the sender was on; empty for building-wide lines. */
    operationId: text("operation_id").notNull().default(""),
    text: text("text").notNull(),
    ts: timestampMs("ts").notNull(),
    ...timestamps(),
  },
  (t) => [index("chat_messages_ts_idx").on(t.ts)],
);
