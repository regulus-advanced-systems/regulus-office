/**
 * Agent lifecycle commands: agent.spawn|prompt|approve|stop|resume|pr (SPEC §6),
 * plus three the spec's list does not name yet: `agent.interrupt` (SPEC §7
 * `AgentControl.interrupt`), `agent.sendHome` (issue #33: free the desk, keep
 * or delete the branch) and `agent.worktree` (read the worktree's uncommitted
 * files for the send-home and PR dialogs).
 *
 * `profileId` names a credential profile; the secret itself never travels
 * over the wire (SPEC §8). `office:<provider>` selects an office-wide key.
 */
import { z } from "zod";
import { Effort, GhNumber, Id, ModelName, PROMPT_MAX, PromptText, ShortText } from "../common.ts";
import { PERMISSION_DECISIONS, PROVIDER_IDS } from "../enums.ts";
import { PermissionModeSchema } from "../permission-modes.ts";

export const SpawnAgentCommand = z.object({
  type: z.literal("agent.spawn"),
  floorId: Id,
  repoId: Id,
  /** Omit to let the server pick a free desk. */
  seatId: Id.optional(),
  provider: z.enum(PROVIDER_IDS),
  model: ModelName,
  effort: Effort.optional(),
  /**
   * The robot's permission mode (#166), in the provider's own terms; omit for
   * the provider default. Which values a provider accepts is checked by the
   * server with `isPermissionModeFor` (a discriminated-union member cannot
   * carry a cross-field refinement).
   */
  permissionMode: PermissionModeSchema.optional(),
  profileId: Id.optional(),
  /**
   * First prompt; empty or omitted = the robot starts idle and waits to be
   * prompted from its panel or terminal (#142).
   */
  prompt: z.string().trim().max(PROMPT_MAX).default(""),
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

/** Cancel the current turn (Claude: Escape; Codex: turn/interrupt). The process keeps running. */
export const InterruptAgentCommand = z.object({
  type: z.literal("agent.interrupt"),
  agentId: Id,
});

/** Stop the agent if needed, release its worktree, free the desk and walk it to the elevator. */
export const SendHomeAgentCommand = z.object({
  type: z.literal("agent.sendHome"),
  agentId: Id,
  /** False deletes the `office/*` branch locally and on the remote. */
  keepBranch: z.boolean(),
});

/** Ask for the worktree's branch and uncommitted files (answered with `agent.result`). */
export const AgentWorktreeCommand = z.object({
  type: z.literal("agent.worktree"),
  agentId: Id,
});

export const agentCommands = [
  SpawnAgentCommand,
  PromptAgentCommand,
  ApproveAgentCommand,
  StopAgentCommand,
  ResumeAgentCommand,
  AgentPrCommand,
  InterruptAgentCommand,
  SendHomeAgentCommand,
  AgentWorktreeCommand,
] as const;
