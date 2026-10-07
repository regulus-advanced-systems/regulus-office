/**
 * Words for office agents in Settings → Agents (#271, #280). Written for
 * someone who does not know the code: every choice has a plain name and one
 * line that says what it means.
 */
import type {
  ModelTier,
  OfficeAgentEngineKind,
  OfficeAgentPreset,
  OfficeAgentRole,
  OfficeAgentRunsOn,
  OfficeAgentStatus,
  OperationAccess,
  RunsOnChoice,
} from "@regulus/protocol";
import { RUNS_ON_LABELS } from "@regulus/protocol";

interface Words {
  label: string;
  /** One line of help. */
  hint: string;
}

/** "Runs as": the program that runs the agent. A new engine needs only an entry here. */
export const ENGINE_WORDS: Readonly<Record<OfficeAgentEngineKind, Words>> = {
  "cli-session": {
    label: "Claude Code session (runs here in the office)",
    hint: "The office starts Claude Code for each message you send. Nothing to install.",
  },
  "hermes-managed": {
    label: "Hermes (runs here in the office)",
    hint: "The office starts and looks after a Hermes agent for you.",
  },
  "hermes-external": {
    label: "My existing Hermes agent (runs somewhere else)",
    hint: "Your own Hermes keeps running where it is and connects to the office.",
  },
  openclaw: {
    label: "OpenClaw (runs here in the office)",
    hint: "The office starts and looks after an OpenClaw agent for you.",
  },
};
export const ENGINE_HELP =
  "The program that runs this agent. It decides which providers and models you can pick below.";
/** On a card, without the explanation in brackets. */
export const engineName = (kind: OfficeAgentEngineKind) =>
  ENGINE_WORDS[kind].label.replace(/\s*\(.*\)$/, "");

/** "Job": what the agent is for. */
export const ROLE_WORDS: Readonly<Record<OfficeAgentRole, Words>> = {
  pm: {
    label: "Project manager",
    hint: "Keeps track of the work and hands it out. One for the office, one per person.",
  },
  assistant: { label: "Assistant", hint: "Helps with whatever you ask it." },
  watchdog: { label: "Watchdog", hint: "Keeps an eye on things and reports what looks wrong." },
  kiosk: { label: "Board helper", hint: "Explains a board to whoever walks up to it." },
  custom: { label: "Something else", hint: "A job you describe yourself in the instructions." },
};

/** "What it may do": each level includes the ones before it. */
export const PRESET_WORDS: Readonly<Record<OfficeAgentPreset, Words>> = {
  observer: {
    label: "Look and ask",
    hint: "It can read operations, boards, queues and usage, and ask people questions. It changes nothing.",
  },
  coordinator: {
    label: "Organise work",
    hint: "It can also add tasks to the queue, comment on issues and pull requests, and post in the chat.",
  },
  manager: {
    label: "Organise work and run henchmen",
    hint: "It can also start and stop henchmen, up to the daily limit the office sets.",
  },
};

/** What a shared agent may do in one operation. */
export const ACCESS_LABELS: Readonly<Record<OperationAccess, string>> = {
  view: "May look",
  spawn: "May look and start henchmen",
  manage: "May do everything a manager of it can",
};

export const STATUS_LABELS: Readonly<Record<OfficeAgentStatus, string>> = {
  stopped: "Stopped",
  starting: "Starting",
  ready: "Ready",
  busy: "Working",
  error: "Error",
};

export const TIER_LABELS: Readonly<Record<ModelTier, string>> = {
  cheap: "Cheap",
  strong: "Strong",
};

/** One line in the "Runs on" list. `login`: whether the owner's Claude login is connected. */
export function runsOnOptionLabel(choice: RunsOnChoice, login: boolean | null | undefined): string {
  if (choice.kind === "login") {
    return `Claude, on my subscription login${login === false ? " (not connected)" : ""}`;
  }
  const whose = choice.owner === "office" ? "the office's key" : "my key";
  return `${RUNS_ON_LABELS[choice.kind]}, ${whose} "${choice.label}"`;
}

/** "DeepSeek (office key "Watchdog key")" on a card; the key's name only when the viewer may know it. */
export function runsOnSummary(runsOn: OfficeAgentRunsOn): string {
  if (runsOn.kind === "unknown") return "a key that is no longer there";
  const name = RUNS_ON_LABELS[runsOn.kind];
  if (runsOn.kind === "login") return name;
  const whose = runsOn.officeKey ? "office key" : "own key";
  return runsOn.label ? `${name} (${whose} "${runsOn.label}")` : `${name} (${whose})`;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(ts: number | undefined, now: number): string {
  if (ts === undefined) return "never";
  const minutes = Math.max(0, Math.floor((now - ts) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / (60 * 24))} d ago`;
}
