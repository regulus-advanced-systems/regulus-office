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
  /** On a card, when the label is a sentence. */
  short?: string;
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
    label: "Hermes, run by the office (nothing to install)",
    short: "Hermes, run by the office",
    hint: "The office starts a Hermes agent of its own for this agent, keeps it running and gives it the office's tools. It runs on a pay-per-use key you pick below; a subscription login cannot be used for it.",
  },
  "hermes-external": {
    label: "Connect my existing Hermes agent",
    short: "My own Hermes",
    hint: "Your own Hermes keeps running where it is, and Telegram and its other channels keep working. The office becomes one more place to talk to it. It brings its own provider and model.",
  },
  openclaw: {
    label: "OpenClaw (runs here in the office)",
    hint: "The office starts and looks after an OpenClaw agent for you.",
  },
};
/** In "Runs as" where the office has no Hermes image: the option is there, greyed out, and says why. */
export const MANAGED_HERMES_OFF = {
  option: "Hermes, run by the office (not turned on in this office)",
  hint: "Hermes run by the office is not turned on here. Whoever runs this office can turn it on: build the Hermes image and set OFFICE_HERMES_IMAGE (README, “Hermes run by the office”).",
} as const;
export const ENGINE_HELP =
  "The program that runs this agent. It decides which providers and models you can pick below.";
/** On a card, without the explanation in brackets. */
export const engineName = (kind: OfficeAgentEngineKind) =>
  ENGINE_WORDS[kind].short ?? ENGINE_WORDS[kind].label.replace(/\s*\(.*\)$/, "");

/** "Job": what the agent is for. */
export const ROLE_WORDS: Readonly<Record<OfficeAgentRole, Words>> = {
  pm: {
    label: "Project manager",
    hint: "Keeps track of the work and hands it out. One for the office, one per person.",
  },
  assistant: { label: "Assistant", hint: "Helps with whatever you ask it." },
  watchdog: { label: "Watchdog", hint: "Keeps an eye on things and reports what looks wrong." },
  kiosk: {
    label: "Board helper",
    hint: "Stands at one board of one room, tells whoever walks up what is on it, and can propose a task for that room's queue, which they confirm themselves. It can do nothing else. Shared agents only.",
  },
  custom: { label: "Something else", hint: "A job you describe yourself in the instructions." },
};

/** The board helper's own words (#56). */
export const KIOSK_WORDS = {
  where:
    "It stands beside that board and never leaves it. Only people who can see the room see it or can talk to it. One helper per board.",
  viaPm: "Run it like the office's project manager",
  viaPmHint:
    "While the office has a project manager that runs as a Claude Code session, the helper uses that manager's key and model, so changing the manager changes its helpers. Otherwise, and with this off, it uses the choice above. It never gets the manager's permissions.",
  noRooms:
    "A board helper stands in a room, and you can see no room: link your GitHub account, or ask someone with access to the repo to place it.",
  presets: {
    observer: "It tells people what is on its board and cannot propose tasks.",
    coordinator:
      "It tells people what is on its board and can propose a task for the queue; nothing is queued until the person confirms.",
    manager:
      "The same as Organise work: a board helper never comments, posts in the chat or runs henchmen.",
  },
  jobFixed: "A board helper's job and room are for life: delete it and place a new one instead.",
  canEnqueue:
    "Ask it below to put something on this room's queue. It will show you the task first; nothing is queued until you confirm.",
  cannotEnqueue: "It can tell you about the board; it cannot queue work for you here.",
  briefFailed: "The board cannot be read right now.",
} as const;

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

/** The agent's soul, memories and notes in the owner's words (#136). */
export const SOUL_WORDS = {
  label: "Who it is and how it works",
  hint: "Written in your own words. The agent reads this every time it starts.",
} as const;
export const MEMORY_WORDS = {
  label: "What it remembers",
  hint: "Short things the agent saved to remember across conversations. You can add, correct and delete them.",
} as const;
export const NOTE_WORDS = {
  label: "Notes",
  hint: "Longer pages the agent keeps: a journal, a draft, a list of decisions.",
} as const;
/** Who can read them: said on the card, so nobody has to guess (D20; rooms: #301). */
export const mindPrivacy = (shared: boolean) =>
  shared
    ? "Office owners and admins can read and change this; of what it remembers and its notes, only what is about rooms they can see themselves. The agent tells a person only what is about rooms that person can see."
    : "Private: only you can read and change this. Office owners and admins cannot.";

/** "$1.24", or "under $0.01" for a first few messages; null when it has cost nothing yet. */
export function costWords(usd: number | undefined): string | null {
  if (!usd || usd <= 0) return null;
  return usd < 0.01 ? "under $0.01" : `$${usd.toFixed(2)}`;
}
