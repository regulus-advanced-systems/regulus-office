/**
 * Office agents in the world (SPEC §9.3, D12, D22, D28, D32; #252): every
 * office agent has a body that walks the lair. A personal agent keeps close
 * to the person it belongs to, a shared one wanders the lobby and the rooms it
 * was granted.
 *
 * The server decides where a body goes and publishes *targets* (a point to
 * walk to), never per-frame positions: each client walks the body there over
 * its own nav grid, so everyone sees the same place and a still body costs
 * no patches. A body is looks only: it gives neither the agent nor anyone
 * else access to anything, and it is never sent into a room its owner
 * (personal) or its grants (shared) do not cover.
 *
 * Bodies are in `BuildingState.officeAgents`, keyed by agent id, each with the
 * level and room it is in and whose it is, so state can be filtered per
 * viewer. Nothing private is in a body: what an agent asked or answered is
 * each person's own (`OfficeAgentAttention`, read over REST).
 */
import { z } from "zod";
import { Count, Id, WorldPos } from "./common.ts";
import { OFFICE_AGENT_STATUSES, OFFICE_AGENTS_API_PATH } from "./office-agents.ts";

/**
 * - `follow`: beside its owner.
 * - `wait`: its owner is somewhere it may not go; it waits at the door.
 * - `wander`: on its own (a shared agent, a dismissed one, one whose owner is away).
 * - `route`: on a scripted route (the office PM's rounds, #60).
 * - `post`: at its home post, or on its way back there (the office PM at reception, #60).
 */
export const OFFICE_AGENT_BODY_MODES = ["follow", "wait", "wander", "route", "post"] as const;
export type OfficeAgentBodyMode = (typeof OFFICE_AGENT_BODY_MODES)[number];

/**
 * A home post (#60): where an agent stands when it has nothing else to do, and
 * where people go to find it. Only the office PM has one, the reception desk
 * in the lobby; walking up to the desk and pressing `E` opens its chat.
 */
export const OFFICE_AGENT_POSTS = ["none", "reception"] as const;
export type OfficeAgentPost = (typeof OFFICE_AGENT_POSTS)[number];

/** Longest "doing" line of a body: a few words on where it stands ("at the usage wall"). */
export const OFFICE_AGENT_DOING_MAX = 48;

export const OfficeAgentBody = z.object({
  agentId: Id,
  name: z.string().max(40),
  /** The person a personal agent belongs to; empty for a shared (office) agent. */
  ownerUserId: z.string().max(128),
  /** That person's name, for "<owner>'s assistant"; empty for a shared agent. */
  ownerName: z.string().max(64),
  /** A character form id (forms.ts); unknown ids are drawn in the standard jumpsuit. */
  appearance: z.string().max(40),
  status: z.enum(OFFICE_AGENT_STATUSES),
  /** Positions are per level, as for people. */
  levelId: Id,
  /** The room the target is in: a project room's operation id, else the lobby's id. */
  operationId: Id,
  mode: z.enum(OFFICE_AGENT_BODY_MODES),
  /** Where it is walking to, or stands; `heading` is the way it faces once there. */
  target: WorldPos,
  /**
   * Counts the times the body was *placed* rather than sent walking (first
   * appearance, a change of level): clients put it at the target at once.
   */
  hop: Count,
  /** Where it stands or what it looks at, never anything from its work. */
  doing: z.string().max(OFFICE_AGENT_DOING_MAX),
  /** A personal agent its owner sent off; it wanders until recalled. */
  dismissed: z.boolean(),
  /** Its home post; `none` for every agent but the office PM. */
  post: z.enum(OFFICE_AGENT_POSTS),
});
export type OfficeAgentBody = z.infer<typeof OfficeAgentBody>;

/** How fast a body walks and runs, metres per second (a person walks at 2.4 and runs at 5.3). */
export const OFFICE_AGENT_WALK_SPEED = 2.4;
export const OFFICE_AGENT_RUN_SPEED = 5.6;
/** A body with further than this to go (along its path) runs to catch up, metres. */
export const OFFICE_AGENT_RUN_ABOVE = 5;
/** How far from its owner a following agent stops, metres. */
export const OFFICE_AGENT_POLITE_DISTANCE = 1.4;

// ---- The office PM's rounds (#60) -------------------------------------------------

/**
 * The office PM leaves reception for a round of the rooms it was granted at
 * fixed times of the clock: every quarter of an hour by default
 * (`OFFICE_PM_ROUND_SECONDS`). Movement and presence only.
 */
export const PM_ROUND_EVERY_MS = 15 * 60_000;
export const PM_ROUND_MIN_MS = 20_000;
export const PM_ROUND_MAX_MS = 60 * 60_000;

// ---- What an agent wants from one person -----------------------------------------

/** `POST /api/office-agents/:id/dismiss` and `/recall`: the owner of a personal agent only. */
export const officeAgentDismissPath = (agentId: string) =>
  `${OFFICE_AGENTS_API_PATH}/${encodeURIComponent(agentId)}/dismiss`;
export const officeAgentRecallPath = (agentId: string) =>
  `${OFFICE_AGENTS_API_PATH}/${encodeURIComponent(agentId)}/recall`;
/** `POST /api/office-agents/:id/seen`: the caller has read their conversation with it. */
export const officeAgentSeenPath = (agentId: string) =>
  `${OFFICE_AGENTS_API_PATH}/${encodeURIComponent(agentId)}/seen`;
/** `GET`: what the caller's agents want from them right now. */
export const OFFICE_AGENT_ATTENTION_API_PATH = `${OFFICE_AGENTS_API_PATH}/attention`;

/**
 * One agent and one person: the open question it put to them, whether it has
 * said something they have not read, and whether it still owes them an answer.
 * Only ever about the caller's own conversations.
 */
export const OfficeAgentAttentionEntry = z.object({
  agentId: Id,
  /** The oldest unanswered "ask a human" question for the caller, if any. */
  question: z.string().optional(),
  /** It replied since the caller last looked at the conversation. */
  unread: z.boolean(),
  /** The caller's last message has no answer yet. */
  waiting: z.boolean(),
});
export type OfficeAgentAttentionEntry = z.infer<typeof OfficeAgentAttentionEntry>;

export const OfficeAgentAttention = z.object({ agents: z.array(OfficeAgentAttentionEntry) });
export type OfficeAgentAttention = z.infer<typeof OfficeAgentAttention>;

/**
 * BuildingRoom → one person's clients: something in their attention list
 * changed (a reply, a question, an answer); read it again over REST. No payload.
 */
export const OFFICE_AGENT_ATTENTION_MESSAGE = "office_agents.attention";
