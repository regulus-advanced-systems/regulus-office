/**
 * Agent lifecycle (SPEC §6 status enum, §7): which status changes are allowed.
 *
 *   starting ──▶ idle | working | waiting_permission | waiting_input | done | error | exited | offline
 *   idle | working | waiting_* | done ◀──▶ each other (a turn starts, asks, ends)
 *   any live status ──▶ error | exited | offline
 *   error ──▶ starting (resume) | idle | working | waiting_* (prompted again) | exited | offline
 *   offline ──▶ starting (resume) | idle | working | waiting_* (re-adopted on boot) | exited
 *   exited ──▶ starting (resume)
 *
 * `exited` is final for the process: late events (a hook that was in flight,
 * a queued structured event) cannot bring a robot back to life; only an
 * explicit resume, which goes through `starting`, can. Guards are enforced in
 * one place, {@link transition}, and the manager ignores refused changes.
 */
import type { AgentStatus } from "@regulus/protocol";

const ACTIVE: readonly AgentStatus[] = [
  "idle",
  "working",
  "waiting_permission",
  "waiting_input",
  "done",
];

const TRANSITIONS: Readonly<Record<AgentStatus, readonly AgentStatus[]>> = {
  starting: [...ACTIVE, "error", "exited", "offline"],
  idle: [...ACTIVE, "error", "exited", "offline"],
  working: [...ACTIVE, "error", "exited", "offline"],
  waiting_permission: [...ACTIVE, "error", "exited", "offline"],
  waiting_input: [...ACTIVE, "error", "exited", "offline"],
  done: [...ACTIVE, "error", "exited", "offline"],
  error: [
    "starting",
    "idle",
    "working",
    "waiting_permission",
    "waiting_input",
    "exited",
    "offline",
  ],
  offline: ["starting", "idle", "working", "waiting_permission", "waiting_input", "exited"],
  exited: ["starting"],
};

/** Statuses in which the agent's process is believed to be running. */
export const LIVE_STATUSES: readonly AgentStatus[] = ["starting", ...ACTIVE, "error"];

/** Statuses from which `resume` may restart the agent. */
export const RESUMABLE_STATUSES: readonly AgentStatus[] = ["exited", "offline", "error"];

export function isLive(status: AgentStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

export function canTransition(from: AgentStatus, to: AgentStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** The status after a requested change: `to` when allowed, otherwise `from` unchanged. */
export function transition(
  from: AgentStatus,
  to: AgentStatus,
): { status: AgentStatus; changed: boolean; refused: boolean } {
  if (from === to) return { status: from, changed: false, refused: false };
  if (!canTransition(from, to)) return { status: from, changed: false, refused: true };
  return { status: to, changed: true, refused: false };
}

/** Raised hand in the world while the robot waits for its human (SPEC §6 RobotState). */
export function handRaised(status: AgentStatus): boolean {
  return status === "waiting_permission" || status === "waiting_input";
}
