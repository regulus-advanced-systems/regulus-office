/**
 * Writes plain protocol shapes (`HenchmanState`, repo summaries, desks) into the
 * OperationRoom's Colyseus schema instances. Pure helpers; no transport.
 */
import {
  DEFAULT_DECOR_STYLE,
  DEFAULT_DESK_COUNT,
  type DecorStyle,
  DeskStateSchema,
  type HenchmanState,
  HenchmanStateSchema,
  type OperationStateSchema,
  type RepoSummary,
  RepoSummarySchema,
} from "@regulus/protocol";

export type OperationRoomState = InstanceType<typeof OperationStateSchema>;
type HenchmanSchema = InstanceType<typeof HenchmanStateSchema>;

/** What the room shows about the operation itself; henchmen come from the registry. */
export interface OperationSnapshot {
  operationId: string;
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

export function writeHenchman(target: HenchmanSchema, henchman: HenchmanState): HenchmanSchema {
  target.agentId = henchman.agentId;
  target.ownerUserId = henchman.ownerUserId;
  target.ownerName = henchman.ownerName;
  target.repoId = henchman.repoId;
  target.seatId = henchman.seatId;
  target.provider = henchman.provider;
  target.model = henchman.model;
  target.effort = henchman.effort;
  target.permissionMode = henchman.permissionMode;
  target.status = henchman.status;
  target.action = henchman.action;
  target.taskTitle = henchman.taskTitle;
  target.taskSummary = henchman.taskSummary;
  target.issueNumber = henchman.issueNumber;
  target.prNumber = henchman.prNumber;
  target.worktreeBranch = henchman.worktreeBranch;
  target.handRaised = henchman.handRaised;
  target.statusReason = henchman.statusReason;
  target.skin = henchman.skin;
  target.bubbleEmits.toolCalls = henchman.bubbleEmits.toolCalls;
  target.bubbleEmits.fileEdits = henchman.bubbleEmits.fileEdits;
  target.bubbleEmits.testRuns = henchman.bubbleEmits.testRuns;
  target.bubbleEmits.toolFailures = henchman.bubbleEmits.toolFailures;
  target.lastActivityAt = henchman.lastActivityAt;
  return target;
}

/** Operation metadata, repos and desks; henchmen are left to {@link syncHenchmen}. */
export function writeSnapshot(state: OperationRoomState, snap: OperationSnapshot): void {
  state.operationId = snap.operationId;
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

/** Make `state.henchmen` equal `henchmen`, and mark their desks occupied. */
export function syncHenchmen(
  state: OperationRoomState,
  henchmen: ReadonlyMap<string, HenchmanState>,
): void {
  for (const id of [...state.henchmen.keys()]) if (!henchmen.has(id)) state.henchmen.delete(id);
  for (const [id, henchman] of henchmen) {
    const existing = state.henchmen.get(id);
    if (existing) writeHenchman(existing, henchman);
    else state.henchmen.set(id, writeHenchman(new HenchmanStateSchema(), henchman));
  }
  const seated = new Map([...henchmen.values()].map((r) => [r.seatId, r.agentId]));
  state.desks.forEach((desk, seatId) => {
    const agentId = seated.get(seatId) ?? "";
    if (desk.agentId !== agentId) desk.agentId = agentId;
  });
}
