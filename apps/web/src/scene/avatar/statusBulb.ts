/**
 * Antenna bulb colour per agent status (SPEC §9.3): grey starting, green
 * idle, blue working, orange waiting-permission with a raised hand, red
 * error, dark exited. The enum has three more states than the spec lists;
 * they are mapped to the nearest listed state: `waiting_input` behaves like
 * `waiting_permission` (also a raised hand, see RobotState.handRaised),
 * `done` like `idle`, `offline` like `exited`.
 */
import type { AgentStatus } from "@regulus/protocol";
import { colors } from "../../ui/theme.ts";

export const BULB_COLORS: Readonly<Record<AgentStatus, string>> = {
  starting: "#9E9E9E",
  idle: "#3DCB6A",
  working: colors.blue,
  waiting_permission: colors.amber,
  waiting_input: colors.amber,
  done: "#3DCB6A",
  error: "#E53935",
  exited: "#2B2B2B",
  offline: "#2B2B2B",
};

/** Bulb colour when no status applies (humans, PM robot). */
export const NEUTRAL_BULB_COLOR = "#F2EFE6";

export function bulbColorFor(status: AgentStatus | undefined): string {
  return status ? BULB_COLORS[status] : NEUTRAL_BULB_COLOR;
}

/** Statuses that raise the robot's hand (SPEC §9.3 "orange waiting-permission with a raised hand"). */
export function handRaisedFor(status: AgentStatus | undefined): boolean {
  return status === "waiting_permission" || status === "waiting_input";
}

/** Bulbs of dark statuses do not glow; the material drops its emissive look. */
export function bulbLitFor(status: AgentStatus | undefined): boolean {
  return status !== "exited" && status !== "offline";
}
