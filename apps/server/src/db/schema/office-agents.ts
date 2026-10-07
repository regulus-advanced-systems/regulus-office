/**
 * Office agents (SPEC §10 M5, D3, D20, D28; #135, #271): the agents
 * themselves, their tokens, the operations a shared agent was granted, each
 * person's conversation with an agent, the questions agents put to people,
 * and the office's caps. Shapes and value sets are in `@regulus/protocol`
 * office-agents.ts.
 */
import {
  HUMAN_REQUEST_STATUSES,
  OFFICE_AGENT_ENGINES,
  OFFICE_AGENT_MESSAGE_AUTHORS,
  OFFICE_AGENT_PRESETS,
  OFFICE_AGENT_ROLES,
  OFFICE_AGENT_STATUSES,
  OPERATION_ACCESSES,
  PROVIDER_IDS,
} from "@regulus/protocol";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumText, id, inEnum, jsonText, timestampMs, timestamps } from "./_columns.ts";
import { operations } from "./operations.ts";
import { users } from "./users.ts";

export const officeAgents = sqliteTable(
  "office_agents",
  {
    id: id(),
    /** Permanent; `nameKey` (lower case) is unique in the office. */
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    /** Null = a shared agent owned by the office; else the one person it belongs to. */
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    engine: enumText("engine", OFFICE_AGENT_ENGINES).notNull(),
    role: enumText("role", OFFICE_AGENT_ROLES).notNull(),
    preset: enumText("preset", OFFICE_AGENT_PRESETS).notNull(),
    provider: enumText("provider", PROVIDER_IDS).notNull(),
    model: text("model").notNull(),
    effort: text("effort"),
    /**
     * Credential choice, a reference only: a `credential_profiles.id`,
     * `office:<provider>`, or null for the owner's own CLI login. A shared
     * agent always names an office key (SPEC §8 rule 3, D2).
     */
    profileId: text("profile_id"),
    /** How it looks (#280, D32): an id from the protocol's `OFFICE_AGENT_APPEARANCES`. Looks only. */
    appearance: text("appearance").notNull().default("standard"),
    /** A personal agent its owner sent off to wander (#252); it stays so across restarts. */
    dismissed: integer("dismissed", { mode: "boolean" }).notNull().default(false),
    /** The role prompt. The soul and memories of #136 come on top of it. */
    instructions: text("instructions").notNull().default(""),
    status: enumText("status", OFFICE_AGENT_STATUSES).notNull().default("stopped"),
    statusReason: text("status_reason"),
    /**
     * The engine's own state as JSON (session ids per conversation, a gateway
     * session map), so a restart continues where it was. Never a credential.
     */
    engineState: jsonText("engine_state").notNull().default("{}"),
    lastActivityAt: timestampMs("last_activity_at"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("office_agents_name_key_unique").on(t.nameKey),
    index("office_agents_owner_idx").on(t.ownerUserId),
    check("office_agents_preset_check", inEnum("preset", OFFICE_AGENT_PRESETS)),
    check("office_agents_status_check", inEnum("status", OFFICE_AGENT_STATUSES)),
  ],
);

/** Per-agent bearer tokens for `/mcp` and the tool REST API; only the SHA-256 is kept. */
export const officeAgentTokens = sqliteTable(
  "office_agent_tokens",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => officeAgents.id, { onDelete: "cascade" }),
    /** SHA-256 (hex) of the token. The plaintext is shown once, at creation. */
    tokenHash: text("token_hash").notNull(),
    /** `api`: minted by whoever configures the agent; `session`: minted by the office for an engine run. */
    kind: text("kind", { enum: ["api", "session"] }).notNull(),
    label: text("label").notNull().default(""),
    lastUsedAt: timestampMs("last_used_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("office_agent_tokens_hash_unique").on(t.tokenHash),
    index("office_agent_tokens_agent_idx").on(t.agentId),
  ],
);

/** What a shared agent may do where; personal agents have their owner's access instead. */
export const officeAgentGrants = sqliteTable(
  "office_agent_grants",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => officeAgents.id, { onDelete: "cascade" }),
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    access: enumText("access", OPERATION_ACCESSES).notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("office_agent_grants_agent_operation_unique").on(t.agentId, t.operationId),
    check("office_agent_grants_access_check", inEnum("access", OPERATION_ACCESSES)),
  ],
);

/** One conversation per agent and person; the office keeps the history. */
export const officeAgentMessages = sqliteTable(
  "office_agent_messages",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => officeAgents.id, { onDelete: "cascade" }),
    /** The person whose conversation with the agent this line is in. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    author: enumText("author", OFFICE_AGENT_MESSAGE_AUTHORS).notNull(),
    text: text("text").notNull(),
    ts: timestampMs("ts").notNull(),
    ...timestamps(),
  },
  (t) => [index("office_agent_messages_conversation_idx").on(t.agentId, t.userId, t.ts)],
);

/**
 * How far a person has read their conversation with an agent (#252): a reply
 * newer than `seenAt` shows as "answer ready" over the agent in the world.
 */
export const officeAgentReads = sqliteTable(
  "office_agent_reads",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => officeAgents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seenAt: timestampMs("seen_at").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("office_agent_reads_agent_user_unique").on(t.agentId, t.userId)],
);

/** "Ask a human": a question an agent put to one person (the bubble of #256 reads these). */
export const officeAgentRequests = sqliteTable(
  "office_agent_requests",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => officeAgents.id, { onDelete: "cascade" }),
    forUserId: text("for_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    optionsJson: jsonText("options_json").notNull().default("[]"),
    operationId: text("operation_id").references(() => operations.id, { onDelete: "set null" }),
    status: enumText("status", HUMAN_REQUEST_STATUSES).notNull().default("pending"),
    answer: text("answer"),
    answeredAt: timestampMs("answered_at"),
    ...timestamps(),
  },
  (t) => [
    index("office_agent_requests_user_status_idx").on(t.forUserId, t.status),
    index("office_agent_requests_agent_idx").on(t.agentId),
    check("office_agent_requests_status_check", inEnum("status", HUMAN_REQUEST_STATUSES)),
  ],
);

/** One row (`id` = `office`): the caps admins set. */
export const officeAgentSettings = sqliteTable("office_agent_settings", {
  id: text("id").primaryKey(),
  personalAgentCap: integer("personal_agent_cap").notNull(),
  managerDailySpawnCap: integer("manager_daily_spawn_cap").notNull(),
  sharedMessagesPerHour: integer("shared_messages_per_hour").notNull(),
  ...timestamps(),
});
