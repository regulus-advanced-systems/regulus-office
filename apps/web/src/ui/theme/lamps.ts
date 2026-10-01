/**
 * Which lamp a status lights (#189). Henchman statuses map the way the
 * henchman's status light does (scene/avatar/statusBulb.ts): grey starting,
 * green idle or done, blue working, amber waiting with a raised hand, red
 * error, dark when stopped or offline. Lamps that want attention blink.
 */
import type { AgentStatus } from "@regulus/protocol";
import type { CSSProperties } from "react";
import type { LampColor } from "./lairPalette.ts";

export const AGENT_LAMPS: Readonly<Record<AgentStatus, LampColor>> = {
  starting: "starting",
  idle: "idle",
  working: "working",
  waiting_permission: "waiting",
  waiting_input: "waiting",
  done: "idle",
  error: "error",
  exited: "off",
  offline: "off",
};

/** Statuses whose lamp blinks: someone has to act. */
export function lampBlinks(status: AgentStatus): boolean {
  return status === "waiting_permission" || status === "waiting_input" || status === "error";
}

/** Inline style that sets a `.rg-lamp`'s colour to the token of `lamp`. */
export function lampStyle(lamp: LampColor): CSSProperties {
  return { "--rg-lamp": `var(--rg-lamp-${lamp})` } as CSSProperties;
}
