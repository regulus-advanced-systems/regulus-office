/**
 * "Open the chat with this office agent" from outside Settings (#256): a click
 * on an office agent's bubble (`conversation` target, ui/agent/bubbleTarget.ts)
 * opens Settings on the Agents tab, and that agent's card opens its chat when
 * it sees the request (AgentCard). One request at a time; the card clears it.
 */
import { create } from "zustand";
import { openSettingsAt } from "../settings/settingsTabs.ts";

interface ChatRequestStore {
  /** The office agent whose chat should open, until its card has taken the request. */
  agentId: string | null;
  request: (agentId: string) => void;
  /** The card of `agentId` took the request. */
  taken: (agentId: string) => void;
}

export const useChatRequest = create<ChatRequestStore>()((set) => ({
  agentId: null,
  request: (agentId) => set({ agentId }),
  taken: (agentId) => set((s) => (s.agentId === agentId ? { agentId: null } : s)),
}));

/** Open Settings → Agents with the chat of this office agent open. */
export function openOfficeAgentChat(agentId: string): void {
  useChatRequest.getState().request(agentId);
  openSettingsAt("agents");
}
