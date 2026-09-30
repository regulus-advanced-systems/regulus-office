/**
 * Fake robots for the dev harness (dev/robots.html): N robots on the desk
 * seats of a template, cycling through statuses/actions and counting up
 * their bubble counters, so animations, bubbles and fps can be checked
 * without a server. Not used by the app.
 */
import type { FloorTemplate } from "@regulus/floor-layout";
import type { AgentAction, AgentStatus, RobotState } from "@regulus/protocol";

const OWNERS = ["Ante", "Mia", "Olga", "Linus"];
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
 * alternating every tick (the animation should not follow it, #159).
 */
export type HarnessMode = "working" | "mixed" | "waiting" | "idle" | "flap";

export function harnessMode(value: string | null): HarnessMode {
  return value === "mixed" || value === "waiting" || value === "idle" || value === "flap"
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
    case "flap":
      return tick % 2 === 0 ? ["working", "typing"] : ["idle", "none"];
    default:
      return SHOWREEL[(Math.floor(tick / 8) + i) % SHOWREEL.length] as [AgentStatus, AgentAction];
  }
}

export function fakeRobots(
  template: FloorTemplate,
  count: number,
  tick: number,
  mode: HarnessMode,
): Record<string, RobotState> {
  const seats = template.seats.filter((s) => s.kind === "desk").slice(0, count);
  const out: Record<string, RobotState> = {};
  seats.forEach((seat, i) => {
    const [status, action] = pairFor(mode, i, tick);
    // Idle robots do no work, so their counters (and bubbles) stay put.
    const count = mode === "idle" ? 0 : tick;
    const agentId = `fake-${seat.id}`;
    const owner = OWNERS[i % OWNERS.length] as string;
    out[agentId] = {
      agentId,
      ownerUserId: `user-${owner}`,
      ownerName: owner,
      repoId: "r1",
      seatId: seat.id,
      provider: i % 2 === 0 ? "claude-code" : "codex",
      model: MODELS[i % MODELS.length] as string,
      effort: "",
      status,
      action,
      taskTitle: `Task ${i + 1}`,
      taskSummary: "",
      issueNumber: 0,
      prNumber: 0,
      worktreeBranch: "",
      handRaised: status === "waiting_permission",
      statusReason: status === "error" ? "demo: a fake failure" : "",
      bubbleEmits: {
        toolCalls: count * 2 + (i % 3),
        fileEdits: Math.floor(count / 2),
        testRuns: Math.floor(count / 5),
        toolFailures: Math.floor(count / 11),
      },
      lastActivityAt: 0,
    };
  });
  return out;
}
