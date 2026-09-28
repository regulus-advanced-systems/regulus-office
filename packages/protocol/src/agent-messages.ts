/**
 * FloorRoom server→client messages about robots (SPEC §6 channel 2, §8 rule 4).
 *
 * - `agent.permissions` goes only to clients that may control the robot (its
 *   owner, or an office owner/admin; never viewers): the pending permission
 *   requests with what exactly is being approved. Everyone else only sees the
 *   public `RobotState.handRaised`. An empty list clears the robot's requests.
 * - `agent.result` answers the caller of an `agent.*` control command that
 *   succeeded (failures are `command.rejected` with the `agentId`).
 * - `agent.leaving` is broadcast when a robot was sent home, so every client
 *   can play the walk to the elevator before the robot leaves the state.
 */
import { z } from "zod";
import { Id, TimestampMs } from "./common.ts";
import { PERMISSION_DECISIONS } from "./enums.ts";

export const AGENT_PERMISSIONS_MESSAGE = "agent.permissions";
export const AGENT_RESULT_MESSAGE = "agent.result";
export const AGENT_LEAVING_MESSAGE = "agent.leaving";

/** One permission request an agent is waiting on (from AgentEvent `permission_request`). */
export const PendingPermission = z.object({
  requestId: z.string().min(1).max(128),
  /** Tool the agent wants to run (`Bash`, `Edit`, `item/commandExecution`, ...). */
  toolName: z.string().max(200),
  /** What exactly would run or change: the command line or file summary. */
  description: z.string().max(2000),
  options: z.array(z.enum(PERMISSION_DECISIONS)).min(1),
  requestedAt: TimestampMs,
  /** After this the office can no longer answer it; answer in the terminal. */
  expiresAt: TimestampMs.optional(),
});
export type PendingPermission = z.infer<typeof PendingPermission>;

export const AgentPermissions = z.object({
  agentId: Id,
  requests: z.array(PendingPermission).max(50),
});
export type AgentPermissions = z.infer<typeof AgentPermissions>;

export const OpenedPullRequestInfo = z.object({
  number: z.number().int().positive(),
  url: z.url().max(500),
  draft: z.boolean(),
  /** False when an open PR for the branch already existed. */
  created: z.boolean(),
  branch: z.string().max(255),
});
export type OpenedPullRequestInfo = z.infer<typeof OpenedPullRequestInfo>;

export const WorktreeInfo = z.object({
  branch: z.string().max(255),
  uncommitted: z.array(z.string().max(1024)).max(500),
});
export type WorktreeInfo = z.infer<typeof WorktreeInfo>;

const ack = <T extends string>(type: T) => z.object({ type: z.literal(type), agentId: Id });

export const AgentCommandResult = z.discriminatedUnion("type", [
  ack("agent.prompt"),
  ack("agent.approve").extend({ requestId: z.string().max(128) }),
  ack("agent.interrupt"),
  ack("agent.stop"),
  ack("agent.resume"),
  ack("agent.sendHome"),
  ack("agent.pr").extend({ pr: OpenedPullRequestInfo }),
  ack("agent.worktree").extend({ worktree: WorktreeInfo }),
]);
export type AgentCommandResult = z.infer<typeof AgentCommandResult>;

export const AgentLeaving = z.object({
  agentId: Id,
  reason: z.enum(["sent_home"]),
});
export type AgentLeaving = z.infer<typeof AgentLeaving>;
