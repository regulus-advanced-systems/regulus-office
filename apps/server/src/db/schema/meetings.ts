/**
 * Meeting room (#50, SPEC §10 M3, D9): a meeting of 2-5 henchmen on one task
 * in a pattern, its members (henchmen the starter spawned) and its turns (the
 * transcript, also the cursor a restart resumes from). Nothing here holds a
 * token or key: `profileId` is a reference to the starter's own profile.
 */
import {
  MEETING_OUTPUTS,
  MEETING_PATTERNS,
  MEETING_ROLES,
  MEETING_STATUSES,
  MEETING_TURN_KINDS,
  MEETING_TURN_STATUSES,
  PROVIDER_IDS,
} from "@regulus/protocol";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumText, id, inEnum, timestampMs, timestamps } from "./_columns.ts";
import { operationRepos, operations } from "./operations.ts";
import { users } from "./users.ts";

export const meetings = sqliteTable(
  "meetings",
  {
    id: id(),
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => operationRepos.id, { onDelete: "cascade" }),
    /** Owns every member henchman (their runner, their credentials) and controls the meeting. */
    startedBy: text("started_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pattern: enumText("pattern", MEETING_PATTERNS).notNull(),
    topic: text("topic").notNull(),
    status: enumText("status", MEETING_STATUSES).notNull().default("starting"),
    reason: text("reason").notNull().default(""),
    rounds: integer("rounds").notNull(),
    tokenBudget: integer("token_budget").notNull(),
    tokensUsed: integer("tokens_used").notNull().default(0),
    turnTimeoutMs: integer("turn_timeout_ms").notNull(),
    output: enumText("output", MEETING_OUTPUTS).notNull(),
    prNumber: integer("pr_number"),
    /** The shared worktree in the starter's area of the operation, and its branch. */
    workdir: text("workdir"),
    branch: text("branch"),
    outputUrl: text("output_url"),
    finishedAt: timestampMs("finished_at"),
    ...timestamps(),
  },
  (t) => [
    index("meetings_operation_idx").on(t.operationId, t.createdAt),
    index("meetings_status_idx").on(t.status),
    check("meetings_pattern_check", inEnum("pattern", MEETING_PATTERNS)),
    check("meetings_status_check", inEnum("status", MEETING_STATUSES)),
    check("meetings_output_check", inEnum("output", MEETING_OUTPUTS)),
  ],
);

export const meetingMembers = sqliteTable(
  "meeting_members",
  {
    id: id(),
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    role: enumText("role", MEETING_ROLES).notNull(),
    name: text("name").notNull(),
    provider: enumText("provider", PROVIDER_IDS).notNull(),
    model: text("model").notNull(),
    effort: text("effort"),
    permissionMode: text("permission_mode"),
    /** The starter's credential profile id or `office:<provider>`, as asked for. */
    profileId: text("profile_id"),
    /** The member's henchman once spawned (not a foreign key: it outlives sending home). */
    agentId: text("agent_id"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("meeting_members_position_unique").on(t.meetingId, t.position),
    index("meeting_members_agent_idx").on(t.agentId),
  ],
);

export const meetingTurns = sqliteTable(
  "meeting_turns",
  {
    id: id(),
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    step: integer("step").notNull(),
    round: integer("round").notNull(),
    position: integer("position").notNull(),
    kind: enumText("kind", MEETING_TURN_KINDS).notNull(),
    status: enumText("status", MEETING_TURN_STATUSES).notNull(),
    text: text("text").notNull().default(""),
    tokens: integer("tokens").notNull().default(0),
    startedAt: timestampMs("started_at").notNull(),
    finishedAt: timestampMs("finished_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("meeting_turns_step_position_unique").on(t.meetingId, t.step, t.position),
    check("meeting_turns_status_check", inEnum("status", MEETING_TURN_STATUSES)),
  ],
);
