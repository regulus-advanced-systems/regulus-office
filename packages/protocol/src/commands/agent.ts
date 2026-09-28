/**
 * Agent lifecycle commands: agent.spawn|prompt|approve|stop|resume|pr (SPEC §6).
 *
 * `profileId` names a credential profile; the secret itself never travels
 * over the wire (SPEC §8). `office:<provider>` selects an office-wide key.
 */
import { z } from "zod";
import { Effort, GhNumber, Id, ModelName, PromptText, ShortText } from "../common.ts";
import { PERMISSION_DECISIONS, PROVIDER_IDS } from "../enums.ts";

export const SpawnAgentCommand = z.object({
  type: z.literal("agent.spawn"),
  floorId: Id,
  repoId: Id,
  /** Omit to let the server pick a free desk. */
  seatId: Id.optional(),
  provider: z.enum(PROVIDER_IDS),
  model: ModelName,
  effort: Effort.optional(),
  profileId: Id.optional(),
  prompt: PromptText,
  taskTitle: ShortText.optional(),
  issueNumber: GhNumber.optional(),
  prNumber: GhNumber.optional(),
  autoWorktree: z.boolean().default(true),
});

export const PromptAgentCommand = z.object({
  type: z.literal("agent.prompt"),
  agentId: Id,
  text: PromptText,
});

export const ApproveAgentCommand = z.object({
  type: z.literal("agent.approve"),
  agentId: Id,
  requestId: Id,
  decision: z.enum(PERMISSION_DECISIONS),
});

export const StopAgentCommand = z.object({
  type: z.literal("agent.stop"),
  agentId: Id,
});

export const ResumeAgentCommand = z.object({
  type: z.literal("agent.resume"),
  agentId: Id,
});

/** One-click PR from the agent's worktree branch. */
export const AgentPrCommand = z.object({
  type: z.literal("agent.pr"),
  agentId: Id,
  title: ShortText.optional(),
  body: z.string().max(20_000).optional(),
  draft: z.boolean().default(false),
});

export const agentCommands = [
  SpawnAgentCommand,
  PromptAgentCommand,
  ApproveAgentCommand,
  StopAgentCommand,
  ResumeAgentCommand,
  AgentPrCommand,
] as const;
