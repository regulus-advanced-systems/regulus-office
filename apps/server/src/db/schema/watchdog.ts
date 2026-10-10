/**
 * The watchdog henchman (SPEC §10 M5, D30; #253): what it watches, its rounds
 * and its findings. Shapes and value sets are in `@regulus/protocol`
 * watchdog.ts.
 *
 * Secrets (SPEC §8): a host's SSH private key and the Sentry token are
 * envelope-encrypted with the office master key, each bound to its own row.
 * Nothing else in these tables is a secret; a host's `hostKey` is its public
 * key.
 */
import {
  PROVIDER_IDS,
  WATCHDOG_COMMENT_STATES,
  WATCHDOG_DISPOSITIONS,
  WATCHDOG_FIX_MODES,
  WATCHDOG_FIX_STATES,
  WATCHDOG_ROUND_STATES,
  WATCHDOG_ROUND_TRIGGERS,
  WATCHDOG_SCOPES,
  WATCHDOG_SOURCE_KINDS,
} from "@regulus/protocol";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumText, id, inEnum, jsonText, timestampMs, timestamps } from "./_columns.ts";
import { officeAgents } from "./office-agents.ts";
import { operations } from "./operations.ts";
import { users } from "./users.ts";

/** One row, id `office`. */
export const watchdogSettings = sqliteTable(
  "watchdog_settings",
  {
    id: text("id").primaryKey(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    /** The shared office agent that does the rounds. */
    agentId: text("agent_id").references(() => officeAgents.id, { onDelete: "set null" }),
    intervalMinutes: integer("interval_minutes").notNull().default(60),
    fixMode: enumText("fix_mode", WATCHDOG_FIX_MODES).notNull().default("ask"),
    fixProvider: enumText("fix_provider", PROVIDER_IDS).notNull().default("claude-code"),
    fixModel: text("fix_model").notNull().default("opus"),
    /** The admin who switched `auto` on: automatic fixes are queued in their name, with their rights. */
    autoFixUserId: text("auto_fix_user_id").references(() => users.id, { onDelete: "set null" }),
    /** How many fixes `auto` may start without a person. */
    autoFixPerRound: integer("auto_fix_per_round").notNull().default(1),
    autoFixPerDay: integer("auto_fix_per_day").notNull().default(3),
    sentryHost: text("sentry_host").notNull().default("sentry.io"),
    sentryOrganization: text("sentry_organization").notNull().default(""),
    /** Envelope (AAD `watchdog_settings:office|sentry_token`). */
    encryptedSentryToken: text("encrypted_sentry_token"),
    /** When the last round was started, whoever asked for it: the schedule counts from here. */
    lastRoundAt: timestampMs("last_round_at"),
    ...timestamps(),
  },
  () => [check("watchdog_settings_fix_mode_check", inEnum("fix_mode", WATCHDOG_FIX_MODES))],
);

export const watchdogHosts = sqliteTable("watchdog_hosts", {
  id: id(),
  label: text("label").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(22),
  username: text("username").notNull(),
  /**
   * The host's pinned public key: `keytype base64` lines. Empty until an
   * admin gives it or the first contact stores it; from then on a check
   * accepts no other key.
   */
  hostKey: text("host_key").notNull().default(""),
  hostKeySource: text("host_key_source", { enum: ["given", "learned", "accepted", "none"] })
    .notNull()
    .default("none"),
  /** The key the host showed instead of the pinned one, until an admin accepts or it goes away. */
  offeredHostKey: text("offered_host_key").notNull().default(""),
  offeredAt: timestampMs("offered_at"),
  /** Envelope (AAD `watchdog_host:<id>|ssh_private_key`). */
  encryptedKey: text("encrypted_key").notNull(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps(),
});

export const watchdogApps = sqliteTable(
  "watchdog_apps",
  {
    id: id(),
    hostId: text("host_id")
      .notNull()
      .references(() => watchdogHosts.id, { onDelete: "cascade" }),
    /** The PM2 process name. */
    name: text("name").notNull(),
    /** The room its findings belong to; null: office owners and admins only. */
    operationId: text("operation_id").references(() => operations.id, { onDelete: "set null" }),
    /**
     * False: nobody watches it, and the row is kept for its room. That is what
     * "stop watching" leaves when it is done by someone who cannot see that
     * room, so that adding the same name again is a change to this row (which
     * only someone who sees the room may make), not a new target.
     */
    watched: integer("watched", { mode: "boolean" }).notNull().default(true),
    /** What the last finished part of a round saw, so the next one reports only what is new. */
    lastRestarts: integer("last_restarts"),
    lastStatus: text("last_status"),
    /** Hash of the last error-log lines the last finished part read. */
    lastLogMark: text("last_log_mark"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("watchdog_apps_host_name_unique").on(t.hostId, t.name)],
);

export const watchdogSentryProjects = sqliteTable(
  "watchdog_sentry_projects",
  {
    id: id(),
    slug: text("slug").notNull(),
    operationId: text("operation_id").references(() => operations.id, { onDelete: "set null" }),
    /** As on `watchdog_apps`. */
    watched: integer("watched", { mode: "boolean" }).notNull().default(true),
    /**
     * Set while Sentry has more new issues of this project than a round reads:
     * the start of the time window whose issues were not all read. The window
     * does not move past it until a round reads them all.
     */
    unreadSince: timestampMs("unread_since"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("watchdog_sentry_projects_slug_unique").on(t.slug)],
);

export const watchdogRounds = sqliteTable(
  "watchdog_rounds",
  {
    id: id(),
    trigger: enumText("trigger", WATCHDOG_ROUND_TRIGGERS).notNull(),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    state: enumText("state", WATCHDOG_ROUND_STATES).notNull(),
    startedAt: timestampMs("started_at").notNull(),
    finishedAt: timestampMs("finished_at"),
    /** Why it failed, in the office's words; names no target. */
    error: text("error"),
    ...timestamps(),
  },
  (t) => [
    index("watchdog_rounds_started_idx").on(t.startedAt),
    check("watchdog_rounds_state_check", inEnum("state", WATCHDOG_ROUND_STATES)),
  ],
);

/**
 * One part of a round: one room's targets, or those without a room. Each part
 * is one turn of the watchdog, so no turn holds two rooms' data.
 */
export const watchdogRoundParts = sqliteTable(
  "watchdog_round_parts",
  {
    id: id(),
    roundId: text("round_id")
      .notNull()
      .references(() => watchdogRounds.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    scope: enumText("scope", WATCHDOG_SCOPES).notNull(),
    /** The room this part reads; a `room` part whose room is gone shows to nobody. */
    operationId: text("operation_id").references(() => operations.id, { onDelete: "set null" }),
    state: enumText("state", WATCHDOG_ROUND_STATES).notNull(),
    startedAt: timestampMs("started_at"),
    /** When the office read this part's targets (`watchdog_check`); null: not read yet. */
    checkedAt: timestampMs("checked_at"),
    finishedAt: timestampMs("finished_at"),
    /** The watchdog's own words about this part: shown to who may see this room now. */
    summary: text("summary").notNull().default(""),
    error: text("error"),
    /** JSON: per app, what this part read (`restarts`, `status`, `logMark`); kept when it finishes. */
    marksJson: jsonText("marks_json").notNull().default("{}"),
    /** JSON: the signals the office handed out in this part, by key, with their lines. */
    signalsJson: jsonText("signals_json").notNull().default("{}"),
    /** JSON: ids of the Sentry projects this part could not read all new issues of. */
    truncatedJson: jsonText("truncated_json").notNull().default("[]"),
    ...timestamps(),
  },
  (t) => [
    index("watchdog_round_parts_round_idx").on(t.roundId),
    check("watchdog_round_parts_state_check", inEnum("state", WATCHDOG_ROUND_STATES)),
  ],
);

export const watchdogFindings = sqliteTable(
  "watchdog_findings",
  {
    id: id(),
    /** The watchdog's words, scrubbed. */
    title: text("title").notNull(),
    /** Lines the office read and handed out, chosen by number; never the model's text. */
    evidence: text("evidence").notNull(),
    disposition: enumText("disposition", WATCHDOG_DISPOSITIONS).notNull(),
    reason: text("reason").notNull(),
    /**
     * Who may see it. `room`: people whose GitHub access opens `operationId`
     * (and nobody once that room is gone: it never falls back to the admins).
     * `office`: its target has no room; office owners and admins. Set when the
     * finding is made and never changed.
     */
    scope: enumText("scope", WATCHDOG_SCOPES).notNull(),
    /** The room it belongs to (where a fix goes). */
    operationId: text("operation_id").references(() => operations.id, { onDelete: "set null" }),
    /** The round that gave it its current verdict (first, or the one that saw it come back). */
    roundId: text("round_id").references(() => watchdogRounds.id, { onDelete: "set null" }),
    /** When it got its current verdict: a regression counts only if it is later than this. */
    judgedAt: timestampMs("judged_at").notNull(),
    /** When the people who may see it were told of its current verdict; null: not yet. */
    announcedAt: timestampMs("announced_at"),
    firstSeenAt: timestampMs("first_seen_at").notNull(),
    lastSeenAt: timestampMs("last_seen_at").notNull(),
    seenCount: integer("seen_count").notNull().default(0),
    regressions: integer("regressions").notNull().default(0),
    /** A person said it is known noise: it stays dismissed whatever comes back. */
    noiseBy: text("noise_by").references(() => users.id, { onDelete: "set null" }),
    noiseAt: timestampMs("noise_at"),
    fixState: enumText("fix_state", WATCHDOG_FIX_STATES).notNull().default("none"),
    fixSummary: text("fix_summary").notNull().default(""),
    /** The queue task of the henchman that writes the fix. */
    fixTaskId: text("fix_task_id"),
    fixDecidedBy: text("fix_decided_by").references(() => users.id, { onDelete: "set null" }),
    /** Started without a person, by the `auto` setting; counted against its caps. */
    fixAuto: integer("fix_auto", { mode: "boolean" }).notNull().default(false),
    fixQueuedAt: timestampMs("fix_queued_at"),
    fixPrNumber: integer("fix_pr_number"),
    fixPrUrl: text("fix_pr_url"),
    fixError: text("fix_error"),
    sentryComment: enumText("sentry_comment", WATCHDOG_COMMENT_STATES).notNull().default("none"),
    ...timestamps(),
  },
  (t) => [
    index("watchdog_findings_last_seen_idx").on(t.lastSeenAt),
    index("watchdog_findings_fix_state_idx").on(t.fixState),
    check("watchdog_findings_disposition_check", inEnum("disposition", WATCHDOG_DISPOSITIONS)),
    check("watchdog_findings_fix_state_check", inEnum("fix_state", WATCHDOG_FIX_STATES)),
  ],
);

/**
 * Where a finding was seen. `key` is what makes a fault one finding across
 * rounds, repeated deliveries and restarts: the signal's key
 * (`sentry:<org>/<SHORT-ID>` or `pm2:<appId>:<signal>`) and the room it was in
 * (`@<operationId>` or `@office`), so a target moved to another room starts a
 * finding of its own there and the old one stays where it was. Unique.
 */
export const watchdogFindingSources = sqliteTable(
  "watchdog_finding_sources",
  {
    id: id(),
    findingId: text("finding_id")
      .notNull()
      .references(() => watchdogFindings.id, { onDelete: "cascade" }),
    kind: enumText("kind", WATCHDOG_SOURCE_KINDS).notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    url: text("url"),
    /** Sentry only: the watched project the office read it from, and Sentry's own id of the issue. */
    project: text("project"),
    ref: text("ref"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("watchdog_finding_sources_key_unique").on(t.key),
    index("watchdog_finding_sources_finding_idx").on(t.findingId),
  ],
);

/**
 * Up to when each person was told of findings in the office UI. A finding is
 * told to a person when they are connected: at once, or when they next are.
 */
export const watchdogTold = sqliteTable("watchdog_told", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** The latest `announcedAt` among the findings this person was told of. */
  toldAt: timestampMs("told_at").notNull(),
});
