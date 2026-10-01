/** Human-readable henchman labels for the agent panel and dialogs. */
import type { AgentStatus, PermissionDecision, ProviderId } from "@regulus/protocol";

export const STATUS_LABELS: Record<AgentStatus, string> = {
  starting: "Starting",
  idle: "Idle",
  working: "Working",
  waiting_permission: "Waiting for approval",
  waiting_input: "Waiting for input",
  done: "Done",
  error: "Error",
  exited: "Stopped",
  offline: "Offline",
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
  opencode: "OpenCode",
  "kimi-code": "Kimi Code",
  custom: "Custom",
};

export const DECISION_LABELS: Record<PermissionDecision, string> = {
  allow_once: "Allow once",
  allow_always: "Allow always",
  reject: "Reject",
};

/** The process is running: prompt, interrupt and stop make sense. */
export function isRunning(status: AgentStatus): boolean {
  return status !== "exited" && status !== "offline";
}

/** `agent.resume` is accepted from these (manager RESUMABLE_STATUSES). */
export function isResumable(status: AgentStatus): boolean {
  return status === "exited" || status === "offline" || status === "error";
}
