/**
 * Usage tracker: token/cost samples per agent and observed provider limits
 * per human (SPEC §5, §9.4 usage wall).
 */
import { LIMIT_WINDOW_KINDS, PROVIDER_IDS, USAGE_SOURCES } from "@regulus/protocol";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { enumText, id, inEnum, timestampMs, timestamps } from "./_columns.ts";
import { agents } from "./agents.ts";
import { users } from "./users.ts";

/** One sample per usage event. `userId` null means the office key (SPEC §8 rule 3). */
export const usageSamples = sqliteTable(
  "usage_samples",
  {
    id: id(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    provider: enumText("provider", PROVIDER_IDS).notNull(),
    ts: timestampMs("ts").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsdEstimate: real("cost_usd_estimate").notNull().default(0),
    source: enumText("source", USAGE_SOURCES).notNull(),
    /** Provider model id when known; the price estimate was computed from it. */
    model: text("model"),
    /** Provider session (Claude session id), to tie transcript usage to a robot. */
    sessionId: text("session_id"),
    /** `<provider>:<source>:<scope>:<id>`; re-reading the same request is a no-op (#40). */
    dedupeKey: text("dedupe_key"),
    ...timestamps(),
  },
  (t) => [
    index("usage_samples_user_ts_idx").on(t.userId, t.ts),
    index("usage_samples_ts_idx").on(t.ts),
    index("usage_samples_session_idx").on(t.sessionId),
    uniqueIndex("usage_samples_dedupe_key_unique").on(t.dedupeKey),
    index("usage_samples_agent_ts_idx").on(t.agentId, t.ts),
    index("usage_samples_provider_ts_idx").on(t.provider, t.ts),
    check("usage_samples_provider_check", inEnum("provider", PROVIDER_IDS)),
    check("usage_samples_source_check", inEnum("source", USAGE_SOURCES)),
  ],
);

/** Latest observed rate-limit window per (user, provider, window); upserted. */
export const usageLimits = sqliteTable(
  "usage_limits",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: enumText("provider", PROVIDER_IDS).notNull(),
    windowKind: enumText("window_kind", LIMIT_WINDOW_KINDS).notNull(),
    usedPct: real("used_pct").notNull(),
    resetsAt: timestampMs("resets_at"),
    observedAt: timestampMs("observed_at").notNull(),
    source: enumText("source", USAGE_SOURCES).notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("usage_limits_user_provider_window_unique").on(t.userId, t.provider, t.windowKind),
    check("usage_limits_provider_check", inEnum("provider", PROVIDER_IDS)),
    check("usage_limits_window_kind_check", inEnum("window_kind", LIMIT_WINDOW_KINDS)),
    check("usage_limits_source_check", inEnum("source", USAGE_SOURCES)),
  ],
);
