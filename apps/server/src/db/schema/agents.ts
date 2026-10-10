/**
 * Henchmen: `agents`, their event stream, credential profiles used to spawn
 * them, and the per-operation task queue (SPEC §5, §7, §8).
 */
import {
  AGENT_EVENT_KINDS,
  AGENT_STATUSES,
  CREDENTIAL_AUTH_KINDS,
  PROVIDER_IDS,
  TASK_KINDS,
  TASK_STATES,
} from "@regulus/protocol";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumText, id, inEnum, jsonText, timestampMs, timestamps } from "./_columns.ts";
import { operationRepos, operations } from "./operations.ts";
import { users } from "./users.ts";

export const agents = sqliteTable(
  "agents",
  {
    id: id(),
    /**
     * The henchman's own name (D29, #256): given with the desk at spawn, unique among the
     * henchmen at a desk, never changed afterwards. "" only on rows from before it, which
     * the AgentStore names on first sight.
     */
    name: text("name").notNull().default(""),
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => operationRepos.id, { onDelete: "cascade" }),
    /** Seat from the operation layout; the `desks` row mirrors this via `desks.agentId`. */
    deskSeatId: text("desk_seat_id").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: enumText("provider", PROVIDER_IDS).notNull(),
    model: text("model").notNull(),
    effort: text("effort"),
    /**
     * Provider permission mode chosen at spawn (#166, protocol
     * `permission-modes.ts`). Null for rows from before it: the provider default.
     */
    permissionMode: text("permission_mode"),
    /** `credential_profiles.id`, or `office:<provider>` for an opt-in office key (SPEC §8 rule 3). */
    profileId: text("profile_id").notNull(),
    status: enumText("status", AGENT_STATUSES).notNull().default("starting"),
    providerSessionId: text("provider_session_id"),
    /** tmux session name, `agent-<agentId>` (SPEC §4.4). */
    tmuxSession: text("tmux_session"),
    workdir: text("workdir").notNull(),
    worktreeBranch: text("worktree_branch"),
    taskTitle: text("task_title").notNull(),
    taskSummary: text("task_summary"),
    issueNumber: integer("issue_number"),
    prNumber: integer("pr_number"),
    lastActivityAt: timestampMs("last_activity_at"),
    exitedAt: timestampMs("exited_at"),
    /** The spawn request as submitted, minus any credential material. */
    spawnArgsJson: jsonText("spawn_args_json").notNull().default("{}"),
    /**
     * SHA-256 (hex) of the agent's hook token (SPEC §8: agent tokens are stored
     * hashed). The plaintext only exists in the agent's runner files. Null once
     * revoked (stop, send home).
     */
    hookTokenHash: text("hook_token_hash"),
    ...timestamps(),
  },
  (t) => [
    index("agents_operation_id_idx").on(t.operationId),
    index("agents_owner_user_id_idx").on(t.ownerUserId),
    index("agents_status_idx").on(t.status),
    check("agents_provider_check", inEnum("provider", PROVIDER_IDS)),
    check("agents_status_check", inEnum("status", AGENT_STATUSES)),
  ],
);

/** Adapter events tagged with the agent id (protocol `AgentEvent`). Rolling retention. */
export const agentEvents = sqliteTable(
  "agent_events",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    ts: timestampMs("ts").notNull(),
    kind: enumText("kind", AGENT_EVENT_KINDS).notNull(),
    payloadJson: jsonText("payload_json").notNull(),
    ...timestamps(),
  },
  (t) => [
    index("agent_events_agent_ts_idx").on(t.agentId, t.ts),
    index("agent_events_ts_idx").on(t.ts),
    check("agent_events_kind_check", inEnum("kind", AGENT_EVENT_KINDS)),
  ],
);

/**
 * How a human (or, with `userId` null, the office) authenticates a provider.
 *
 * SPEC §8: subscription OAuth logins (`cli_login`) are never stored here; the
 * unmodified CLI keeps them in the runner's HOME. `encryptedSecret` holds only
 * the opaque envelope produced by the secrets module for API keys / plan keys.
 * Office-wide rows (`userId` null) are allowed only for `api_key` /
 * `base_url_key` (rule 3); the check below enforces that at the database.
 */
export const credentialProfiles = sqliteTable(
  "credential_profiles",
  {
    id: id(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    provider: enumText("provider", PROVIDER_IDS).notNull(),
    label: text("label").notNull(),
    authKind: enumText("auth_kind", CREDENTIAL_AUTH_KINDS).notNull(),
    encryptedSecret: text("encrypted_secret"),
    baseUrl: text("base_url"),
    modelOverridesJson: jsonText("model_overrides_json"),
    verifiedAt: timestampMs("verified_at"),
    ...timestamps(),
  },
  (t) => [
    index("credential_profiles_user_provider_idx").on(t.userId, t.provider),
    check("credential_profiles_provider_check", inEnum("provider", PROVIDER_IDS)),
    check("credential_profiles_auth_kind_check", inEnum("auth_kind", CREDENTIAL_AUTH_KINDS)),
    // cli_login rows never carry a secret and are always personal (SPEC §8 rules 1 and 3).
    check(
      "credential_profiles_cli_login_check",
      sql.raw(
        `"auth_kind" <> 'cli_login' OR ("encrypted_secret" IS NULL AND "user_id" IS NOT NULL)`,
      ),
    ),
  ],
);

/**
 * One task across several repos (#257, D7): what its parts (rows of `tasks`
 * with this `linkedTaskId`, one per room) have in common. The parts' own
 * state lives on their task rows; nothing here names a room.
 */
export const linkedTasks = sqliteTable("linked_tasks", {
  id: id(),
  title: text("title").notNull().default(""),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /**
   * Pass every note a part leaves on to the other parts without asking the
   * owner. Off unless the owner turns it on: a note passed on can be read by
   * everyone who may watch a henchman in any of the task's rooms.
   */
  releaseNotes: integer("release_notes", { mode: "boolean" }).notNull().default(false),
  /**
   * Name private repos in each other's pull requests. Off unless the owner
   * turns it on; public repos are always named.
   */
  namePrivateRepos: integer("name_private_repos", { mode: "boolean" }).notNull().default(false),
  ...timestamps(),
});

/** Per-operation queue of work to spawn henchmen for (SPEC §5 `tasks`, §9.4 clipboard). */
export const tasks = sqliteTable(
  "tasks",
  {
    id: id(),
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    /** Repo the task binds to; null means the operation's primary repo. */
    repoId: text("repo_id").references(() => operationRepos.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    kind: enumText("kind", TASK_KINDS).notNull(),
    refNumber: integer("ref_number"),
    prompt: text("prompt").notNull(),
    provider: enumText("provider", PROVIDER_IDS).notNull(),
    model: text("model").notNull(),
    effort: text("effort"),
    autoWorktree: integer("auto_worktree", { mode: "boolean" }).notNull().default(true),
    state: enumText("state", TASK_STATES).notNull().default("queued"),
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Task title for the henchman and the clipboard (#37). */
    title: text("title").notNull().default(""),
    /** Provider permission mode for the henchman; null = the provider default (#166). */
    permissionMode: text("permission_mode"),
    /**
     * The owner's credential profile id (or `office:<provider>`), a reference
     * only; null = their own CLI login. Never a secret (SPEC §8).
     */
    profileId: text("profile_id"),
    /** The PR the task's henchman opened, once it appears (#35 cache / event bus). */
    prNumber: integer("pr_number"),
    /** Why it failed, or why a queued task is not starting; safe to show. */
    reason: text("reason").notNull().default(""),
    /** The linked task this is one part of (#257); null for an ordinary task. */
    linkedTaskId: text("linked_task_id").references(() => linkedTasks.id, {
      onDelete: "set null",
    }),
    /** Why the office opened no draft PR for a finished part of a linked task; safe to show. */
    prNote: text("pr_note").notNull().default(""),
    /** What the office has already collected of this part's notes file (a linked task's part). */
    notesSeen: text("notes_seen").notNull().default(""),
    startedAt: timestampMs("started_at"),
    finishedAt: timestampMs("finished_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("tasks_operation_position_unique").on(t.operationId, t.position),
    index("tasks_operation_state_idx").on(t.operationId, t.state),
    index("tasks_linked_task_idx").on(t.linkedTaskId),
    check("tasks_kind_check", inEnum("kind", TASK_KINDS)),
    check("tasks_state_check", inEnum("state", TASK_STATES)),
    check("tasks_provider_check", inEnum("provider", PROVIDER_IDS)),
  ],
);

/**
 * What a part's henchman left in its notes file for the task's owner (#257).
 * Only the owner reads these; a note reaches the other parts' worktrees once
 * it is released (by the owner, or at once when the task releases them
 * automatically).
 */
export const linkedTaskNotes = sqliteTable(
  "linked_task_notes",
  {
    id: id(),
    linkedTaskId: text("linked_task_id")
      .notNull()
      .references(() => linkedTasks.id, { onDelete: "cascade" }),
    /** The part whose henchman wrote it. */
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    releasedAt: timestampMs("released_at"),
    ...timestamps(),
  },
  (t) => [index("linked_task_notes_linked_task_idx").on(t.linkedTaskId)],
);

/** A room's queue concurrency (#37); a room without a row uses the protocol defaults. */
export const operationQueueSettings = sqliteTable("operation_queue_settings", {
  operationId: text("operation_id")
    .primaryKey()
    .references(() => operations.id, { onDelete: "cascade" }),
  maxRunning: integer("max_running").notNull(),
  maxPerOwner: integer("max_per_owner").notNull(),
  ...timestamps(),
});
