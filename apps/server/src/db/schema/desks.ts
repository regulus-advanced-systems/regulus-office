/**
 * Desks: one row per seat of the floor's layout template (`packages/room-layout`),
 * `agentId` set while a robot occupies it (SPEC §5).
 */
import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, timestamps } from "./_columns.ts";
import { agents } from "./agents.ts";
import { floors } from "./floors.ts";

export const desks = sqliteTable(
  "desks",
  {
    id: id(),
    floorId: text("floor_id")
      .notNull()
      .references(() => floors.id, { onDelete: "cascade" }),
    seatId: text("seat_id").notNull(),
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("desks_floor_seat_unique").on(t.floorId, t.seatId),
    uniqueIndex("desks_agent_id_unique").on(t.agentId),
  ],
);
