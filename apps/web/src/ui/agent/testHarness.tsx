/** Test helpers for the agent UI: a henchman on the operation, a signed-in user, a recording sender. */
import type { HenchmanState, OperationState, UserRole } from "@regulus/protocol";
import { henchmanFixture, operationFixture } from "@regulus/protocol/src/fixtures.ts";
import type { ReactNode } from "react";
import { useOperationStore } from "../../state/operation.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { type AgentSender, AgentSenderContext } from "./agentCommands.ts";
import { useAgentStore } from "./agentStore.ts";

export const HENCHMAN_OWNER = "u-owner";

export function henchman(patch: Partial<HenchmanState> = {}): HenchmanState {
  return {
    ...henchmanFixture,
    agentId: "a1",
    ownerUserId: HENCHMAN_OWNER,
    ownerName: "Mia",
    ...patch,
  };
}

export function seed(options: {
  role?: UserRole;
  userId?: string;
  henchman?: Partial<HenchmanState>;
}) {
  useAgentStore.getState().reset();
  useUiStore.setState({ overlay: null });
  useSessionStore.setState({
    status: "authenticated",
    user: {
      id: options.userId ?? HENCHMAN_OWNER,
      displayName: "Me",
      role: options.role ?? "member",
    },
  });
  const r = henchman(options.henchman);
  useOperationStore
    .getState()
    .apply({ ...operationFixture, henchmen: { [r.agentId]: r } } as OperationState);
  return r;
}

export function recorder() {
  const sent: { type: string; payload: Record<string, unknown> }[] = [];
  const send: AgentSender = (type, payload) => {
    useAgentStore.getState().started(payload.agentId, type);
    sent.push({ type, payload: payload as Record<string, unknown> });
  };
  const wrap = (node: ReactNode) => (
    <AgentSenderContext.Provider value={send}>{node}</AgentSenderContext.Provider>
  );
  return { sent, wrap };
}

export const buttonByText = (label: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label) as
    | HTMLButtonElement
    | undefined;

export const bodyText = () => document.body.textContent ?? "";
