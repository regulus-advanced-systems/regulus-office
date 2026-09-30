/**
 * The FloorRoom's view of the AgentManager: `agent.spawn` and the robot
 * controls in, a result or a rejection reason out. Reasons are the manager's
 * human-safe messages; anything unexpected becomes "internal error" and is
 * logged server-side (message only, never objects that might carry env).
 */
import type { AgentCommandResult } from "@regulus/protocol";
import type {
  AgentControlCommand,
  AgentControlOutcome,
  FloorAgentCommands,
} from "../../rooms/floor/room.ts";
import { AgentManagerError } from "./errors.ts";
import type { AgentManager } from "./manager.ts";
import { errorSummary } from "./runtime.ts";

type Actor = Parameters<AgentManager["prompt"]>[0];

async function run(
  manager: AgentManager,
  actor: Actor,
  command: AgentControlCommand,
): Promise<AgentCommandResult> {
  const { agentId } = command;
  switch (command.type) {
    case "agent.prompt":
      await manager.prompt(actor, agentId, command.text);
      return { type: command.type, agentId };
    case "agent.approve":
      await manager.respondPermission(actor, agentId, command.requestId, command.decision);
      return { type: command.type, agentId, requestId: command.requestId };
    case "agent.interrupt":
      await manager.interrupt(actor, agentId);
      return { type: command.type, agentId };
    case "agent.stop":
      await manager.stop(actor, agentId);
      return { type: command.type, agentId };
    case "agent.emergencyStop":
      await manager.emergencyStop(actor, agentId, command.reason);
      return { type: command.type, agentId };
    case "agent.resume":
      await manager.resume(actor, agentId);
      return { type: command.type, agentId };
    case "agent.sendHome":
      await manager.sendHome(actor, agentId, { keepBranch: command.keepBranch });
      return { type: command.type, agentId };
    case "agent.worktree": {
      const worktree = await manager.worktreeStatus(actor, agentId);
      return { type: command.type, agentId, worktree };
    }
    case "agent.pr": {
      const pr = await manager.openPullRequest(actor, agentId, {
        draft: command.draft,
        title: command.title,
        body: command.body,
      });
      return {
        type: command.type,
        agentId,
        pr: {
          number: pr.number,
          url: pr.url,
          draft: pr.draft,
          created: pr.created,
          branch: pr.branch,
        },
      };
    }
  }
}

export function floorAgentCommands(manager: AgentManager): FloorAgentCommands {
  return {
    async spawn(actor, command) {
      const { type: _type, ...input } = command;
      try {
        await manager.spawn(actor, input);
        return { ok: true };
      } catch (err) {
        if (err instanceof AgentManagerError) return { ok: false, reason: err.message };
        manager.logger.error({ err: String(err) }, "agent.spawn failed");
        return { ok: false, reason: "internal error" };
      }
    },

    async control(actor, command): Promise<AgentControlOutcome> {
      try {
        return { ok: true, result: await run(manager, actor, command) };
      } catch (err) {
        if (err instanceof AgentManagerError) {
          return { ok: false, reason: err.message, files: err.files };
        }
        manager.logger.error(
          { err: errorSummary(err), type: command.type },
          "agent command failed",
        );
        return { ok: false, reason: "internal error" };
      }
    },
  };
}
