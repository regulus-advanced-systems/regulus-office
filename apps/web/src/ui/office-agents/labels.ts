/** Words for office agent enums in Settings → Agents (#271). */
import type {
  OfficeAgentEngineKind,
  OfficeAgentPreset,
  OfficeAgentRole,
  OfficeAgentStatus,
} from "@regulus/protocol";

export const ENGINE_LABELS: Readonly<Record<OfficeAgentEngineKind, string>> = {
  "cli-session": "Claude Code session",
  "hermes-managed": "Hermes (managed)",
  "hermes-external": "Hermes (external gateway)",
  openclaw: "OpenClaw",
};

export const ROLE_LABELS: Readonly<Record<OfficeAgentRole, string>> = {
  pm: "PM",
  assistant: "Assistant",
  watchdog: "Watchdog",
  kiosk: "Kiosk",
  custom: "Custom",
};

export const PRESET_LABELS: Readonly<Record<OfficeAgentPreset, string>> = {
  observer: "Observer",
  coordinator: "Coordinator",
  manager: "Manager",
};

export const PRESET_HINTS: Readonly<Record<OfficeAgentPreset, string>> = {
  observer: "Reads operations, boards, queues and usage, and can ask people questions.",
  coordinator: "Also queues tasks, comments on issues and PRs, and posts in the chat.",
  manager: "Also spawns and stops henchmen, within the daily cap.",
};

export const STATUS_LABELS: Readonly<Record<OfficeAgentStatus, string>> = {
  stopped: "Stopped",
  starting: "Starting",
  ready: "Ready",
  busy: "Working",
  error: "Error",
};

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(ts: number | undefined, now: number): string {
  if (ts === undefined) return "never";
  const minutes = Math.max(0, Math.floor((now - ts) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / (60 * 24))} d ago`;
}
