/**
 * Office agents (SPEC §10 M5, D2, D3, D4, D20, D28, D32; #135, #271): the
 * long-lived agents of the office, as opposed to the come-and-go coding
 * henchmen at desks.
 *
 * An office agent has an owner (the office for a *shared* agent, one person for
 * a *personal* one), a role, an engine, a model choice and a privilege preset.
 * It acts only through the office tools (office-agent-tools.ts), offered over
 * MCP at `/mcp` and as REST, with a per-agent token.
 *
 * Who may do what (the server enforces all of it):
 * - a personal agent has exactly its owner's rights at the moment of each
 *   call, never more; only its owner may talk to it, command it, configure it
 *   or read its instructions and conversation. Office admins see that it
 *   exists (name, engine, status) and may only emergency-stop it;
 * - a shared agent is created and configured by office owners and admins,
 *   has the operations it was granted, and everyone signed in may talk to it;
 * - a shared agent runs on an office-wide metered key only, never on a
 *   person's subscription login (SPEC §8 rule 3, D2).
 */
import { z } from "zod";
import { Effort, Id, ModelName, TimestampMs } from "./common.ts";
import {
  OPERATION_ACCESSES,
  PM_PRIVILEGES,
  type PmPrivilege,
  PROVIDER_IDS,
  type UserRole,
} from "./enums.ts";

export const OFFICE_AGENTS_API_PATH = "/api/office-agents";
/** Settings (caps), owners and admins. */
export const OFFICE_AGENT_SETTINGS_API_PATH = "/api/office-agents/settings";
/** The signed-in person's pending "ask a human" requests. */
export const OFFICE_AGENT_REQUESTS_API_PATH = "/api/office-agents/requests";

/** Engines an office agent can run on (D3). Hermes and OpenClaw plug in with #57 and #58. */
export const OFFICE_AGENT_ENGINES = [
  "cli-session",
  "hermes-managed",
  "hermes-external",
  "openclaw",
] as const;
export type OfficeAgentEngineKind = (typeof OFFICE_AGENT_ENGINES)[number];

export const OFFICE_AGENT_ROLES = ["pm", "assistant", "watchdog", "kiosk", "custom"] as const;
export type OfficeAgentRole = (typeof OFFICE_AGENT_ROLES)[number];

/** Privilege presets (SPEC §10 M5, D4): each includes the ones before it. */
export const OFFICE_AGENT_PRESETS = PM_PRIVILEGES;
export type OfficeAgentPreset = PmPrivilege;
/** D4: the PM's default. */
export const DEFAULT_OFFICE_AGENT_PRESET: OfficeAgentPreset = "coordinator";

export const OFFICE_AGENT_STATUSES = ["stopped", "starting", "ready", "busy", "error"] as const;
export type OfficeAgentStatus = (typeof OFFICE_AGENT_STATUSES)[number];

/** Providers the CLI session engine can run today (Codex is a follow-up). */
export const CLI_SESSION_PROVIDERS = ["claude-code"] as const;

export const OFFICE_AGENT_LIMITS = {
  nameMax: 40,
  instructionsMax: 8000,
  messageMax: 8000,
  questionMax: 1000,
  optionMax: 80,
  optionsMax: 6,
  answerMax: 2000,
  /** Messages one conversation page returns. */
  conversationPage: 100,
  /** Live API tokens one agent can hold. */
  tokensPerAgent: 5,
  personalCapMax: 50,
  dailySpawnCapMax: 200,
} as const;

export const DEFAULT_OFFICE_AGENT_SETTINGS = {
  /** Personal agents one person may have. */
  personalAgentCap: 3,
  /** Henchmen a `manager` agent may spawn per office day. */
  managerDailySpawnCap: 10,
} as const;

/** Permanent, unique in the office: letters, digits, spaces, `-`, `_`, `.`. */
export const OfficeAgentName = z
  .string()
  .trim()
  .min(1)
  .max(OFFICE_AGENT_LIMITS.nameMax)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u);

/** `office` for a shared agent, a user id for a personal one. */
export const OfficeAgentOwner = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("office") }),
  z.object({ kind: z.literal("user"), userId: Id, displayName: z.string().max(200) }),
]);
export type OfficeAgentOwner = z.infer<typeof OfficeAgentOwner>;

export const OfficeAgentGrant = z.object({
  operationId: Id,
  access: z.enum(OPERATION_ACCESSES),
});
export type OfficeAgentGrant = z.infer<typeof OfficeAgentGrant>;

export const OfficeAgentView = z.object({
  id: Id,
  name: z.string(),
  owner: OfficeAgentOwner,
  engine: z.enum(OFFICE_AGENT_ENGINES),
  role: z.enum(OFFICE_AGENT_ROLES),
  preset: z.enum(OFFICE_AGENT_PRESETS),
  provider: z.enum(PROVIDER_IDS),
  model: z.string(),
  effort: z.string().optional(),
  status: z.enum(OFFICE_AGENT_STATUSES),
  statusReason: z.string().optional(),
  lastActivityAt: TimestampMs.optional(),
  createdAt: TimestampMs,
  /** The viewer may open a chat with it. */
  canTalk: z.boolean(),
  /** The viewer may configure, start, stop and delete it and mint tokens. */
  canConfigure: z.boolean(),
  /** Only for viewers who may configure it. */
  config: z
    .object({
      instructions: z.string(),
      /** Credential choice: a profile id, `office:<provider>`, or absent for the owner's CLI login. */
      profileId: z.string().optional(),
      /** Shared agents only: the operations it was granted. */
      grants: z.array(OfficeAgentGrant),
      tokens: z.array(
        z.object({
          id: Id,
          label: z.string(),
          createdAt: TimestampMs,
          lastUsedAt: TimestampMs.optional(),
        }),
      ),
    })
    .optional(),
});
export type OfficeAgentView = z.infer<typeof OfficeAgentView>;

export const OfficeAgentSettings = z.object({
  personalAgentCap: z.number().int().min(0).max(OFFICE_AGENT_LIMITS.personalCapMax),
  managerDailySpawnCap: z.number().int().min(0).max(OFFICE_AGENT_LIMITS.dailySpawnCapMax),
});
export type OfficeAgentSettings = z.infer<typeof OfficeAgentSettings>;

export const OfficeAgentsResponse = z.object({
  agents: z.array(OfficeAgentView),
  settings: OfficeAgentSettings,
  /** Engines this office can start an agent on right now. */
  engines: z.array(z.enum(OFFICE_AGENT_ENGINES)),
});
export type OfficeAgentsResponse = z.infer<typeof OfficeAgentsResponse>;

const Instructions = z.string().max(OFFICE_AGENT_LIMITS.instructionsMax);

export const CreateOfficeAgent = z.object({
  name: OfficeAgentName,
  /** `office` needs an office owner or admin; `me` is the caller's own personal agent. */
  owner: z.enum(["office", "me"]),
  engine: z.enum(OFFICE_AGENT_ENGINES),
  role: z.enum(OFFICE_AGENT_ROLES),
  preset: z.enum(OFFICE_AGENT_PRESETS).default(DEFAULT_OFFICE_AGENT_PRESET),
  provider: z.enum(PROVIDER_IDS),
  model: ModelName,
  effort: Effort.optional(),
  profileId: Id.optional(),
  instructions: Instructions.default(""),
});
export type CreateOfficeAgent = z.input<typeof CreateOfficeAgent>;

/** The name and the owner never change; `profileId: null` goes back to the owner's CLI login. */
export const UpdateOfficeAgent = z
  .object({
    role: z.enum(OFFICE_AGENT_ROLES),
    preset: z.enum(OFFICE_AGENT_PRESETS),
    model: ModelName,
    effort: Effort.nullable(),
    profileId: Id.nullable(),
    instructions: Instructions,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to change" });
export type UpdateOfficeAgent = z.input<typeof UpdateOfficeAgent>;

export const SetOfficeAgentGrants = z.object({ grants: z.array(OfficeAgentGrant).max(200) });

export const CreateOfficeAgentToken = z.object({ label: z.string().trim().min(1).max(60) });
/** The only time a token is shown. */
export const OfficeAgentTokenCreated = z.object({
  id: Id,
  label: z.string(),
  token: z.string(),
});
export type OfficeAgentTokenCreated = z.infer<typeof OfficeAgentTokenCreated>;

// ---- Conversation -----------------------------------------------------------

export const OFFICE_AGENT_MESSAGE_AUTHORS = ["person", "agent", "system"] as const;
export type OfficeAgentMessageAuthor = (typeof OFFICE_AGENT_MESSAGE_AUTHORS)[number];

export const OfficeAgentMessage = z.object({
  id: Id,
  author: z.enum(OFFICE_AGENT_MESSAGE_AUTHORS),
  text: z.string(),
  ts: TimestampMs,
});
export type OfficeAgentMessage = z.infer<typeof OfficeAgentMessage>;

export const OfficeAgentConversation = z.object({
  agentId: Id,
  messages: z.array(OfficeAgentMessage),
  /** The person's last message has no answer yet. */
  waiting: z.boolean(),
  status: z.enum(OFFICE_AGENT_STATUSES),
});
export type OfficeAgentConversation = z.infer<typeof OfficeAgentConversation>;

export const SendOfficeAgentMessage = z.object({
  text: z.string().trim().min(1).max(OFFICE_AGENT_LIMITS.messageMax),
});

// ---- "Ask a human" requests ---------------------------------------------------

export const HUMAN_REQUEST_STATUSES = ["pending", "answered", "cancelled"] as const;
export type HumanRequestStatus = (typeof HUMAN_REQUEST_STATUSES)[number];

/** A question an office agent put to one person; the bubble (#256) and Settings show it. */
export const HumanRequest = z.object({
  id: Id,
  agentId: Id,
  agentName: z.string(),
  forUserId: Id,
  question: z.string(),
  /** Suggested answers; free text is always accepted. */
  options: z.array(z.string()),
  operationId: Id.optional(),
  status: z.enum(HUMAN_REQUEST_STATUSES),
  answer: z.string().optional(),
  createdAt: TimestampMs,
  answeredAt: TimestampMs.optional(),
});
export type HumanRequest = z.infer<typeof HumanRequest>;

export const HumanRequestsResponse = z.object({ requests: z.array(HumanRequest) });
export const AnswerHumanRequest = z.object({
  answer: z.string().trim().min(1).max(OFFICE_AGENT_LIMITS.answerMax),
});

// ---- Who may do what (pure; the server and the UI share these) ----------------

export interface OfficeAgentActor {
  id: string;
  role: UserRole;
}
/** `ownerUserId` null = a shared agent. */
export interface OfficeAgentOwnership {
  ownerUserId: string | null;
}

const isOfficeAdmin = (role: UserRole) => role === "owner" || role === "admin";

/** Open a chat with it, see the conversation, answer its questions (D32: a personal agent, only its owner). */
export function mayTalkToOfficeAgent(actor: OfficeAgentActor, agent: OfficeAgentOwnership) {
  return agent.ownerUserId === null ? true : agent.ownerUserId === actor.id;
}

/** Configure, start, stop, delete, mint tokens, read instructions (D20: admins cannot read personal agents). */
export function mayConfigureOfficeAgent(actor: OfficeAgentActor, agent: OfficeAgentOwnership) {
  return agent.ownerUserId === null ? isOfficeAdmin(actor.role) : agent.ownerUserId === actor.id;
}

/** See that it exists: shared ones and one's own; office admins see every agent's card. */
export function maySeeOfficeAgent(actor: OfficeAgentActor, agent: OfficeAgentOwnership) {
  return agent.ownerUserId === null || agent.ownerUserId === actor.id || isOfficeAdmin(actor.role);
}

/** Stop someone else's personal agent in an emergency (audited); nothing else. */
export function mayEmergencyStopOfficeAgent(actor: OfficeAgentActor, agent: OfficeAgentOwnership) {
  return agent.ownerUserId !== null && agent.ownerUserId !== actor.id && isOfficeAdmin(actor.role);
}

/** Create a shared agent: office owners and admins. Viewers create nothing. */
export function mayCreateOfficeAgent(actor: OfficeAgentActor, owner: "office" | "me") {
  return owner === "office" ? isOfficeAdmin(actor.role) : actor.role !== "viewer";
}
