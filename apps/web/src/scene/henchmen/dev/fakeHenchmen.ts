/**
 * Fake henchmen for the dev harness (dev/office.html): N henchmen on the desk
 * seats of a template (or on every seat), cycling through statuses/actions and counting up
 * their bubble counters, so animations, bubbles and fps can be checked
 * without a server. Not used by the app.
 */

import {
  type AgentAction,
  type AgentBubble,
  type AgentStatus,
  HENCHMAN_SKIN_IDS,
  type HenchmanState,
  NO_AGENT_BUBBLE,
  PROVIDER_IDS,
} from "@regulus/protocol";
import type { RoomTemplate } from "@regulus/room-layout";

const OWNERS = ["Ante", "Mia", "Olga", "Linus"];
const FAKE_NAMES = ["Gasket", "Rivet", "Klaxon", "Shim", "Dowel", "Soot", "Fuse", "Winch"];
const FILES = ["auth.ts", "room.tsx", "schema.sql", "README.md", "index.ts"];

/** The bubble the server would publish for a fake's status and action (#256). */
function fakeBubble(
  agentId: string,
  status: AgentStatus,
  action: AgentAction,
  i: number,
): AgentBubble {
  const file = FILES[i % FILES.length] as string;
  const doing = (text: string): AgentBubble => ({
    kind: "doing",
    text,
    targetKind: "none",
    targetId: "",
  });
  const terminal = { targetKind: "terminal", targetId: agentId } as const;
  switch (status) {
    case "starting":
      return doing("starting up");
    case "working":
      if (action === "reading") return doing(`reading ${file}`);
      if (action === "editing") return doing(`editing ${file}`);
      if (action === "thinking") return doing("thinking");
      if (action === "running_tests") return doing("running tests");
      if (action === "failing") return doing("hit a snag");
      return doing(i % 2 ? "running git" : "writing a reply");
    case "waiting_permission":
      return {
        kind: "needs_you",
        text: "waiting for you: approve a command",
        targetKind: "permission",
        targetId: agentId,
      };
    case "waiting_input":
      return { kind: "needs_you", text: "waiting for you: answer a question", ...terminal };
    case "done":
      return { kind: "answer_ready", text: "finished: take a look", ...terminal };
    case "error":
      return { kind: "needs_you", text: "hit an error: take a look", ...terminal };
    default:
      return NO_AGENT_BUBBLE;
  }
}
const MODELS = ["opus", "gpt-5-codex", "sonnet"];
/** Status/action pairs the "mixed" mode rotates through. */
const SHOWREEL: ReadonlyArray<[AgentStatus, AgentAction]> = [
  ["working", "typing"],
  ["working", "reading"],
  ["working", "thinking"],
  ["waiting_permission", "none"],
  ["working", "editing"],
  ["working", "failing"],
  ["done", "celebrating"],
  ["idle", "none"],
  ["error", "failing"],
  ["starting", "none"],
];

/**
 * working: all typing/reading; mixed: the showreel; waiting: hands up; idle:
 * all idle (should sit still, #159); flap: working/typing and idle/none
 * alternating every tick (the animation should not follow it, #159); day: an ordinary
 * day, most at work, one asking, one with a question, one done, one idle (the bubbles, #256);
 * hands: done, waiting for permission, waiting for an answer and working side by side (#235).
 */
export type HarnessMode = "working" | "mixed" | "waiting" | "idle" | "flap" | "day" | "hands";

/** The "hands" mode's cast (#235), repeated along the desks. */
const HANDS: ReadonlyArray<[AgentStatus, AgentAction]> = [
  ["working", "typing"],
  ["done", "none"],
  ["waiting_permission", "none"],
  ["waiting_input", "none"],
  ["working", "reading"],
  ["idle", "none"],
];

/** The "day" mode's cast, repeated along the desks. */
const DAY: ReadonlyArray<[AgentStatus, AgentAction]> = [
  ["working", "reading"],
  ["working", "typing"],
  ["waiting_permission", "none"],
  ["working", "editing"],
  ["working", "running_tests"],
  ["done", "none"],
  ["working", "thinking"],
  ["idle", "none"],
  ["working", "editing"],
  ["waiting_input", "none"],
  ["working", "typing"],
  ["working", "reading"],
];

export function harnessMode(value: string | null): HarnessMode {
  return value === "mixed" ||
    value === "waiting" ||
    value === "idle" ||
    value === "flap" ||
    value === "day" ||
    value === "hands"
    ? value
    : "working";
}

function pairFor(mode: HarnessMode, i: number, tick: number): [AgentStatus, AgentAction] {
  switch (mode) {
    case "working":
      return ["working", i % 3 === 0 ? "reading" : "typing"];
    case "waiting":
      return ["waiting_permission", "none"];
    case "idle":
      return ["idle", "none"];
    case "day":
      return DAY[i % DAY.length] as [AgentStatus, AgentAction];
    case "hands":
      return HANDS[i % HANDS.length] as [AgentStatus, AgentAction];
    case "flap":
      return tick % 2 === 0 ? ["working", "typing"] : ["idle", "none"];
    default:
      return SHOWREEL[(Math.floor(tick / 8) + i) % SHOWREEL.length] as [AgentStatus, AgentAction];
  }
}

/** Which skins and providers the fakes get (#184): `mixed` cycles through them all. */
export interface FakeLooks {
  skins?: "standard" | "mixed";
  providers?: "two" | "all";
}

export function fakeHenchmen(
  template: RoomTemplate,
  count: number,
  tick: number,
  mode: HarnessMode,
  allSeats = false,
  looks: FakeLooks = {},
  /** Seat the fakes at the desks nearest this point of the room (the player), not in seat order. */
  near?: { x: number; z: number },
): Record<string, HenchmanState> {
  // `allSeats`: meeting, bistro, reception and lounge seats too (#163 seating checks).
  const pool = template.seats.filter((s) => allSeats || s.kind === "desk");
  const far = (s: (typeof pool)[number]) =>
    near ? Math.hypot(s.pose.x - near.x, s.pose.z - near.z) : 0;
  const seats = (near ? [...pool].sort((a, b) => far(a) - far(b)) : pool).slice(0, count);
  const out: Record<string, HenchmanState> = {};
  seats.forEach((seat, i) => {
    const [status, action] = pairFor(mode, i, tick);
    // Idle henchmen do no work, so their counters (and bubbles) stay put.
    const count = mode === "idle" ? 0 : tick;
    const agentId = `fake-${seat.id}`;
    const owner = OWNERS[i % OWNERS.length] as string;
    out[agentId] = {
      agentId,
      name: FAKE_NAMES[i % FAKE_NAMES.length] as string,
      ownerUserId: `user-${owner}`,
      ownerName: owner,
      repoId: "r1",
      seatId: seat.id,
      provider:
        looks.providers === "all"
          ? (PROVIDER_IDS[i % PROVIDER_IDS.length] ?? "custom")
          : i % 2 === 0
            ? "claude-code"
            : "codex",
      model: MODELS[i % MODELS.length] as string,
      effort: "",
      permissionMode: i % 2 === 0 ? "auto" : "on-request",
      status,
      action,
      taskTitle: `Task ${i + 1}`,
      taskSummary: "",
      issueNumber: 0,
      prNumber: 0,
      worktreeBranch: "",
      handRaised: status === "waiting_permission" || status === "waiting_input",
      statusReason: status === "error" ? "demo: a fake failure" : "",
      skin:
        looks.skins === "mixed"
          ? (HENCHMAN_SKIN_IDS[i % HENCHMAN_SKIN_IDS.length] ?? "standard")
          : "standard",
      bubbleEmits: {
        toolCalls: count * 2 + (i % 3),
        fileEdits: Math.floor(count / 2),
        testRuns: Math.floor(count / 5),
        toolFailures: Math.floor(count / 11),
      },
      bubble: fakeBubble(agentId, status, action, i),
      lastActivityAt: 0,
    };
  });
  return out;
}
