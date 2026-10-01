/**
 * Desks: one row per seat of the operation's layout template (`packages/room-layout`),
 * `agentId` set while a henchman occupies it (SPEC §5).
 */
import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, timestamps } from "./_columns.ts";
import { agents } from "./agents.ts";
import { operations } from "./operations.ts";

export const desks = sqliteTable(
  "desks",
  {
    id: id(),
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    seatId: text("seat_id").notNull(),
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("desks_operation_seat_unique").on(t.operationId, t.seatId),
    uniqueIndex("desks_agent_id_unique").on(t.agentId),
  ],
);
