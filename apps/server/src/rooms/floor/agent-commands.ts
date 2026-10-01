/**
 * FloorRoom handlers for the robot controls (SPEC §6, §7; issue #33):
 * `agent.prompt|approve|interrupt|stop|resume|sendHome|pr|worktree` and
 * `agent.emergencyStop`.
 *
 * Each command is already zod-validated by the room. Here it must name a
 * robot on this room's floor, and the sender must be allowed to control it
 * (D12, #138: the robot's owner only; viewers never, admins neither). The one
 * exception is `agent.emergencyStop`, open to office owners/admins on any
 * robot (`mayEmergencyStop`). The AgentManager checks the same rules again. A failure goes back to the sender
 * as `command.rejected` with the `agentId` (and, for a PR refused over a
 * dirty worktree, the files); a success goes back to the sender only as
 * `agent.result` (the PR URL, the worktree status, or a plain ack).
 */
import {
  AGENT_LEAVING_MESSAGE,
  AGENT_RESULT_MESSAGE,
  type AgentCommandResult,
  type AgentLeaving,
  type ClientCommand,
  COMMAND_REJECTED_MESSAGE,
  type CommandRejected,
  type RobotState,
  type UserRole,
} from "@regulus/protocol";
import type { Logger } from "../../logging.ts";
import type { RoomClient } from "../transport.ts";
import { mayControl, mayEmergencyStopAs } from "./permissions.ts";

export const AGENT_CONTROL_TYPES = [
  "agent.prompt",
  "agent.approve",
  "agent.interrupt",
  "agent.stop",
  "agent.emergencyStop",
  "agent.resume",
  "agent.sendHome",
  "agent.pr",
  "agent.worktree",
] as const;
export type AgentControlType = (typeof AGENT_CONTROL_TYPES)[number];
export type AgentControlCommand = Extract<ClientCommand, { type: AgentControlType }>;

export type AgentControlOutcome =
  | { ok: true; result: AgentCommandResult }
  | { ok: false; reason: string; files?: readonly string[] };

/** Why a non-owner's control command is refused (the panel shows a note instead). */
export const NOT_OWNER_REASON = "only the henchman's owner may control it";

export interface AgentActor {
  id: string;
  role: UserRole;
}

export function isAgentControl(command: ClientCommand): command is AgentControlCommand {
  return (AGENT_CONTROL_TYPES as readonly string[]).includes(command.type);
}

export function rejection(
  type: string,
  reason: string,
  extra: { agentId?: string; files?: readonly string[] } = {},
): CommandRejected {
  return {
    type,
    reason: reason.slice(0, 500),
    ...(extra.agentId ? { agentId: extra.agentId } : {}),
    ...(extra.files && extra.files.length > 0 ? { files: extra.files.slice(0, 500) } : {}),
  };
}

export interface AgentControlContext {
  floorId: string;
  client: RoomClient;
  /** The robot as published on this floor, if it is here. */
  robot: RobotState | undefined;
  control:
    | ((actor: AgentActor, command: AgentControlCommand) => Promise<AgentControlOutcome>)
    | undefined;
  /** Every client in the room (for `agent.leaving`). */
  broadcast: (type: string, payload: unknown) => void;
  logger: Logger;
}

export function handleAgentControl(ctx: AgentControlContext, command: AgentControlCommand): void {
  const { client, robot } = ctx;
  const reject = (reason: string, files?: readonly string[]) =>
    client.send(
      COMMAND_REJECTED_MESSAGE,
      rejection(command.type, reason, { agentId: command.agentId, files }),
    );
  if (!robot) {
    reject("no such henchman in this operation");
    return;
  }
  if (command.type === "agent.emergencyStop") {
    if (!mayEmergencyStopAs(client)) {
      reject("only an office owner or admin may emergency-stop a henchman");
      return;
    }
  } else if (!mayControl(client, robot.ownerUserId)) {
    reject(NOT_OWNER_REASON);
    return;
  }
  if (!ctx.control) {
    reject("agents are not available");
    return;
  }
  const actor = { id: client.user.userId, role: client.user.role };
  ctx
    .control(actor, command)
    .then((outcome) => {
      if (!outcome.ok) {
        reject(outcome.reason, outcome.files);
        return;
      }
      client.send(AGENT_RESULT_MESSAGE, outcome.result);
      if (command.type === "agent.sendHome") {
        const leaving: AgentLeaving = { agentId: command.agentId, reason: "sent_home" };
        ctx.broadcast(AGENT_LEAVING_MESSAGE, leaving);
      }
    })
    .catch((err) => {
      ctx.logger.error({ err: String(err), type: command.type }, "agent command failed");
      reject("internal error");
    });
}
