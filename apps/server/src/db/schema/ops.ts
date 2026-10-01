/**
 * Operational tables (SPEC §5): detected dev servers, PM henchman briefs, and the
 * audit log of privileged actions.
 */
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, jsonText, timestampMs, timestamps } from "./_columns.ts";
import { agents } from "./agents.ts";
import { users } from "./users.ts";

/**
 * Dev servers listening in a henchman's sandbox (SPEC §9.4 services board, #39), one row
 * per henchman and port, kept current by services/scanner.ts.
 */
export const services = sqliteTable(
  "services",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    pid: integer("pid").notNull(),
    port: integer("port").notNull(),
    /** Authenticated proxy path, `/p/<operationId>/a/<agentId>/port/<n>/`. */
    url: text("url").notNull(),
    title: text("title"),
    /** Bind address inside the sandbox (`0.0.0.0`, `::`, `127.0.0.1`, ...). */
    address: text("address").notNull().default(""),
    firstSeenAt: timestampMs("first_seen_at").notNull(),
    lastSeenAt: timestampMs("last_seen_at").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("services_agent_port_unique").on(t.agentId, t.port)],
);

/** Briefs written by the PM henchman; `forUserId` null = office-wide (SPEC §10 M5). */
export const pmBriefs = sqliteTable(
  "pm_briefs",
  {
    id: id(),
    ts: timestampMs("ts").notNull(),
    forUserId: text("for_user_id").references(() => users.id, { onDelete: "cascade" }),
    markdown: text("markdown").notNull(),
    deliveredAt: timestampMs("delivered_at"),
    ...timestamps(),
  },
  (t) => [index("pm_briefs_user_ts_idx").on(t.forUserId, t.ts)],
);

/** Who did what to which object; never contains credential material. */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: id(),
    /** Null for system-initiated actions or after the user was deleted. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id"),
    metaJson: jsonText("meta_json").notNull().default("{}"),
    ...timestamps(),
  },
  (t) => [
    index("audit_log_user_created_idx").on(t.userId, t.createdAt),
    index("audit_log_target_idx").on(t.targetKind, t.targetId),
  ],
);
