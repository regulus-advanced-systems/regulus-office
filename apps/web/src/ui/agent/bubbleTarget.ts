/**
 * Where a click on an agent's bubble, or on a "needs you" notification, lands
 * (#256): the pending permission request, the henchman's terminal for a
 * question, or its panel. Office agents register how their conversation opens
 * (`setConversationOpener`) when they arrive; until then that target is inert.
 */
import type { AgentBubble, NotificationEvent } from "@regulus/protocol";
import { useTerminalModal } from "../terminal/terminalStore.ts";
import { useAgentStore } from "./agentStore.ts";

let openConversation: ((agentId: string) => void) | null = null;

/** Office agents: how a `conversation` target opens. Returns an unregister function. */
export function setConversationOpener(open: (agentId: string) => void): () => void {
  openConversation = open;
  return () => {
    if (openConversation === open) openConversation = null;
  };
}

function openPermission(agentId: string): void {
  const agents = useAgentStore.getState();
  // Only a controller holds the request; anyone else gets the panel.
  if (agents.permissions[agentId]?.length) agents.openPermissionPrompt(agentId);
  else agents.openAgentPanel(agentId);
}

/** Open what the bubble points at. Returns false when there was nothing to open. */
export function openBubbleTarget(bubble: Pick<AgentBubble, "targetKind" | "targetId">): boolean {
  const id = bubble.targetId;
  if (!id) return false;
  switch (bubble.targetKind) {
    case "permission":
      openPermission(id);
      return true;
    case "terminal":
      useTerminalModal.getState().openTerminal(id);
      return true;
    case "conversation":
      if (!openConversation) return false;
      openConversation(id);
      return true;
    default:
      return false;
  }
}

/** A notification about a henchman was clicked and we are in its room: open its request. */
export function openHenchmanRequest(agentId: string, event: NotificationEvent): void {
  if (event === "needs_permission") openPermission(agentId);
  else if (event === "needs_input") {
    useAgentStore.getState().openAgentPanel(agentId);
    useTerminalModal.getState().openTerminal(agentId);
  } else useAgentStore.getState().openAgentPanel(agentId);
}
