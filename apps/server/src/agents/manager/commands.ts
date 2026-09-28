/**
 * The FloorRoom's view of the AgentManager: `agent.spawn` in, a rejection
 * reason out. Reasons are the manager's human-safe messages; anything
 * unexpected becomes "internal error" and is logged server-side.
 */
import type { FloorAgentCommands } from "../../rooms/floor/room.ts";
import { AgentManagerError } from "./errors.ts";
import type { AgentManager } from "./manager.ts";

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
  };
}
