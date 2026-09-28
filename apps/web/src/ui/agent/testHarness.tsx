/** Test helpers for the agent UI: a robot on the floor, a signed-in user, a recording sender. */
import type { FloorState, RobotState, UserRole } from "@regulus/protocol";
import { floorFixture, robotFixture } from "@regulus/protocol/src/fixtures.ts";
import type { ReactNode } from "react";
import { useFloorStore } from "../../state/floor.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { type AgentSender, AgentSenderContext } from "./agentCommands.ts";
import { useAgentStore } from "./agentStore.ts";

export const ROBOT_OWNER = "u-owner";

export function robot(patch: Partial<RobotState> = {}): RobotState {
  return { ...robotFixture, agentId: "a1", ownerUserId: ROBOT_OWNER, ownerName: "Mia", ...patch };
}

export function seed(options: { role?: UserRole; userId?: string; robot?: Partial<RobotState> }) {
  useAgentStore.getState().reset();
  useUiStore.setState({ overlay: null });
  useSessionStore.setState({
    status: "authenticated",
    user: {
      id: options.userId ?? ROBOT_OWNER,
      displayName: "Me",
      role: options.role ?? "member",
    },
  });
  const r = robot(options.robot);
  useFloorStore.getState().apply({ ...floorFixture, robots: { [r.agentId]: r } } as FloorState);
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
