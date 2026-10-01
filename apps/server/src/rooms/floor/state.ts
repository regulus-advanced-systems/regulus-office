/**
 * Writes plain protocol shapes (`RobotState`, repo summaries, desks) into the
 * FloorRoom's Colyseus schema instances. Pure helpers; no transport.
 */
import {
  DEFAULT_DECOR_STYLE,
  DEFAULT_DESK_COUNT,
  type DecorStyle,
  DeskStateSchema,
  type FloorStateSchema,
  type RepoSummary,
  RepoSummarySchema,
  type RobotState,
  RobotStateSchema,
} from "@regulus/protocol";

export type FloorRoomState = InstanceType<typeof FloorStateSchema>;
type RobotSchema = InstanceType<typeof RobotStateSchema>;

/** What the room shows about the floor itself; robots come from the registry. */
export interface FloorSnapshot {
  floorId: string;
  name: string;
  slug: string;
  paletteId: string;
  layoutTemplateId: string;
  /** Room settings (#182); absent in older fixtures: 1 desk, the default style. */
  deskCount?: number;
  decorStyle?: DecorStyle;
  repos: RepoSummary[];
  /** Desk seats of the template, with the occupying agent id or "". */
  desks: Array<{ seatId: string; agentId: string }>;
}

export function writeRobot(target: RobotSchema, robot: RobotState): RobotSchema {
  target.agentId = robot.agentId;
  target.ownerUserId = robot.ownerUserId;
  target.ownerName = robot.ownerName;
  target.repoId = robot.repoId;
  target.seatId = robot.seatId;
  target.provider = robot.provider;
  target.model = robot.model;
  target.effort = robot.effort;
  target.permissionMode = robot.permissionMode;
  target.status = robot.status;
  target.action = robot.action;
  target.taskTitle = robot.taskTitle;
  target.taskSummary = robot.taskSummary;
  target.issueNumber = robot.issueNumber;
  target.prNumber = robot.prNumber;
  target.worktreeBranch = robot.worktreeBranch;
  target.handRaised = robot.handRaised;
  target.statusReason = robot.statusReason;
  target.skin = robot.skin;
  target.bubbleEmits.toolCalls = robot.bubbleEmits.toolCalls;
  target.bubbleEmits.fileEdits = robot.bubbleEmits.fileEdits;
  target.bubbleEmits.testRuns = robot.bubbleEmits.testRuns;
  target.bubbleEmits.toolFailures = robot.bubbleEmits.toolFailures;
  target.lastActivityAt = robot.lastActivityAt;
  return target;
}

/** Floor metadata, repos and desks; robots are left to {@link syncRobots}. */
export function writeSnapshot(state: FloorRoomState, snap: FloorSnapshot): void {
  state.floorId = snap.floorId;
  state.name = snap.name;
  state.slug = snap.slug;
  state.paletteId = snap.paletteId;
  state.layoutTemplateId = snap.layoutTemplateId;
  state.deskCount = snap.deskCount ?? DEFAULT_DESK_COUNT;
  state.decorStyle = snap.decorStyle ?? DEFAULT_DECOR_STYLE;

  state.repos.clear();
  for (const repo of snap.repos) {
    const entry = new RepoSummarySchema();
    entry.repoId = repo.repoId;
    entry.owner = repo.owner;
    entry.name = repo.name;
    entry.defaultBranch = repo.defaultBranch;
    entry.isPrimary = repo.isPrimary;
    state.repos.push(entry);
  }

  const seats = new Set(snap.desks.map((d) => d.seatId));
  for (const seatId of [...state.desks.keys()]) if (!seats.has(seatId)) state.desks.delete(seatId);
  for (const desk of snap.desks) {
    const entry = state.desks.get(desk.seatId) ?? new DeskStateSchema();
    entry.seatId = desk.seatId;
    if (!state.desks.has(desk.seatId)) {
      entry.agentId = desk.agentId;
      state.desks.set(desk.seatId, entry);
    }
  }
}

/** Make `state.robots` equal `robots`, and mark their desks occupied. */
export function syncRobots(state: FloorRoomState, robots: ReadonlyMap<string, RobotState>): void {
  for (const id of [...state.robots.keys()]) if (!robots.has(id)) state.robots.delete(id);
  for (const [id, robot] of robots) {
    const existing = state.robots.get(id);
    if (existing) writeRobot(existing, robot);
    else state.robots.set(id, writeRobot(new RobotStateSchema(), robot));
  }
  const seated = new Map([...robots.values()].map((r) => [r.seatId, r.agentId]));
  state.desks.forEach((desk, seatId) => {
    const agentId = seated.get(seatId) ?? "";
    if (desk.agentId !== agentId) desk.agentId = agentId;
  });
}
