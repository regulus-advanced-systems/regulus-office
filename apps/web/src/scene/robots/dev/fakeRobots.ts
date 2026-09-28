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

export function fakeRobots(
  template: FloorTemplate,
  count: number,
  tick: number,
  mode: "working" | "mixed" | "waiting",
): Record<string, RobotState> {
  const seats = template.seats.filter((s) => s.kind === "desk").slice(0, count);
  const out: Record<string, RobotState> = {};
  seats.forEach((seat, i) => {
    const phase = Math.floor(tick / 8) + i;
    const [status, action] =
      mode === "working"
        ? (["working", i % 3 === 0 ? "reading" : "typing"] as const)
        : mode === "waiting"
          ? (["waiting_permission", "none"] as const)
          : (SHOWREEL[phase % SHOWREEL.length] as [AgentStatus, AgentAction]);
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
      bubbleEmits: {
        toolCalls: tick * 2 + (i % 3),
        fileEdits: Math.floor(tick / 2),
        testRuns: Math.floor(tick / 5),
        toolFailures: Math.floor(tick / 11),
      },
      lastActivityAt: 0,
    };
  });
  return out;
}
