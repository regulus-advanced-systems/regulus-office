/**
 * The bubble over an agent's head (SPEC §9.3, D29; #256): a few words on what
 * it is doing now, that it needs its human, or that it has an answer ready.
 * One shape for every agent: henchmen carry it in `HenchmanState.bubble`;
 * office agents (the PM, assistants) use the same shape and the same web
 * component (`apps/web/src/scene/agentBubble`).
 *
 * The text is written by the server from structured adapter events (tool
 * kind, a file's base name, a program name), never from terminal output,
 * prompts or file contents, and is redacted before it is published. It lives
 * in the OperationRoom state only, so it reaches the people in that room.
 */
import { z } from "zod";

/**
 * - `none`: nothing to show (idle, exited).
 * - `doing`: what the agent is doing now ("reading auth.ts").
 * - `needs_you`: it waits for its human (a permission, a question, an error).
 * - `answer_ready`: it finished and has something to look at.
 */
export const AGENT_BUBBLE_KINDS = ["none", "doing", "needs_you", "answer_ready"] as const;
export type AgentBubbleKind = (typeof AGENT_BUBBLE_KINDS)[number];

/**
 * What a click on the bubble opens:
 * - `terminal`: the agent's terminal (`targetId` = agent id);
 * - `permission`: its pending permission request (`targetId` = agent id);
 * - `conversation`: a conversation with an office agent (`targetId` = its id).
 */
export const AGENT_BUBBLE_TARGETS = ["none", "terminal", "permission", "conversation"] as const;
export type AgentBubbleTarget = (typeof AGENT_BUBBLE_TARGETS)[number];

/** Longest bubble text; a few words, one line. */
export const AGENT_BUBBLE_MAX_TEXT = 64;
/** Longest agent name (name tag, notifications). */
export const AGENT_NAME_MAX = 32;

export const AgentBubble = z.object({
  kind: z.enum(AGENT_BUBBLE_KINDS),
  text: z.string().max(AGENT_BUBBLE_MAX_TEXT),
  targetKind: z.enum(AGENT_BUBBLE_TARGETS),
  /** Empty when `targetKind` is `none`. */
  targetId: z.string().max(128),
});
export type AgentBubble = z.infer<typeof AgentBubble>;

export const NO_AGENT_BUBBLE: AgentBubble = Object.freeze({
  kind: "none",
  text: "",
  targetKind: "none",
  targetId: "",
});

/** Does the bubble show at all? */
export function agentBubbleShown(bubble: AgentBubble | undefined): bubble is AgentBubble {
  return !!bubble && bubble.kind !== "none" && bubble.text.length > 0;
}

/** Bubbles that ask for the viewer; these stay when activity bubbles are hidden. */
export function agentBubbleAsks(bubble: AgentBubble | undefined): boolean {
  return agentBubbleShown(bubble) && bubble.kind !== "doing";
}
