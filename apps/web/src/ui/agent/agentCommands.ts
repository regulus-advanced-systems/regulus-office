/**
 * Sending henchman control commands (#33) through the OperationRoom. Each command
 * is marked in flight until the server answers with `agent.result` or
 * `command.rejected` (agentSync.ts). Components get the sender from
 * {@link AgentSenderContext} so tests can record what would be sent.
 */
import type { ClientCommandPayload } from "@regulus/protocol";
import { createContext, useContext } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { useAgentStore } from "./agentStore.ts";

export type AgentControlType =
  | "agent.prompt"
  | "agent.approve"
  | "agent.interrupt"
  | "agent.stop"
  | "agent.emergencyStop"
  | "agent.resume"
  | "agent.sendHome"
  | "agent.pr"
  | "agent.worktree";

export type AgentSender = <T extends AgentControlType>(
  type: T,
  payload: ClientCommandPayload<T>,
) => void;

/** Sends through the page's OfficeClient; a missing operation room becomes a refusal. */
export const officeAgentSender: AgentSender = (type, payload) => {
  const store = useAgentStore.getState();
  store.started(payload.agentId, type);
  try {
    getOfficeClient().send(type, payload);
  } catch {
    store.refused(payload.agentId, { type, reason: "not connected to this operation" });
  }
};

export const AgentSenderContext = createContext<AgentSender>(officeAgentSender);

export function useAgentSender(): AgentSender {
  return useContext(AgentSenderContext);
}
