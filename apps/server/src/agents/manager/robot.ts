/**
 * What the world shows of an agent (protocol `RobotState`), derived from the
 * persisted row plus the event stream: status (through the state machine),
 * the desk animation (`action`), the raised hand and the bubble counters.
 */
import { HUMAN_WAIT_REASONS } from "@regulus/agent-adapters";
import type {
  AgentAction,
  AgentEvent,
  AgentStatus,
  ProviderId,
  RobotState,
  ToolKind,
} from "@regulus/protocol";
import { MAX_STATUS_REASON, safeReason } from "./failure.ts";
import { handRaised, transition } from "./state-machine.ts";

export interface AgentView {
  agentId: string;
  floorId: string;
  repoId: string;
  seatId: string;
  ownerUserId: string;
  ownerName: string;
  provider: ProviderId;
  model: string;
  effort: string;
  status: AgentStatus;
  /** Why the robot is in `error` (safe to publish, failure.ts); "" otherwise. */
  statusReason: string;
  action: AgentAction;
  taskTitle: string;
  taskSummary: string;
  issueNumber: number;
  prNumber: number;
  worktreeBranch: string;
  lastActivityAt: number;
  bubbles: { toolCalls: number; fileEdits: number; testRuns: number; toolFailures: number };
  /** Tool call ids already counted, so repeated updates of one call count once. */
  seenCalls: Set<string>;
  failedCalls: Set<string>;
}

/** A fresh view of a persisted `agents` row (bubbles restart at zero). */
export function viewFromRow(
  row: {
    id: string;
    floorId: string;
    repoId: string;
    deskSeatId: string;
    ownerUserId: string;
    provider: ProviderId;
    model: string;
    effort: string | null;
    status: AgentStatus;
    taskTitle: string;
    taskSummary: string | null;
    issueNumber: number | null;
    prNumber: number | null;
    worktreeBranch: string | null;
    lastActivityAt: Date | null;
  },
  ownerName: string,
): AgentView {
  return {
    agentId: row.id,
    floorId: row.floorId,
    repoId: row.repoId,
    seatId: row.deskSeatId,
    ownerUserId: row.ownerUserId,
    ownerName,
    provider: row.provider,
    model: row.model,
    effort: row.effort ?? "",
    status: row.status,
    statusReason: "",
    action: "none",
    taskTitle: row.taskTitle,
    taskSummary: row.taskSummary ?? "",
    issueNumber: row.issueNumber ?? 0,
    prNumber: row.prNumber ?? 0,
    worktreeBranch: row.worktreeBranch ?? "",
    lastActivityAt: row.lastActivityAt?.getTime() ?? 0,
    bubbles: { toolCalls: 0, fileEdits: 0, testRuns: 0, toolFailures: 0 },
    seenCalls: new Set(),
    failedCalls: new Set(),
  };
}

const TEST_COMMAND =
  /\b(test|tests|jest|vitest|pytest|rspec|mocha|playwright|cargo test|go test|bun test)\b/i;

const TOOL_ACTIONS: Readonly<Record<ToolKind, AgentAction>> = {
  read: "reading",
  search: "reading",
  edit: "editing",
  delete: "editing",
  move: "editing",
  execute: "typing",
  think: "thinking",
  fetch: "browsing",
  other: "typing",
};

/** Keep seen-call sets bounded for long-running agents. */
const MAX_SEEN_CALLS = 512;

export function robotState(view: AgentView): RobotState {
  return {
    agentId: view.agentId,
    ownerUserId: view.ownerUserId,
    ownerName: view.ownerName.slice(0, 64),
    repoId: view.repoId,
    seatId: view.seatId,
    provider: view.provider,
    model: view.model.slice(0, 100),
    effort: view.effort.slice(0, 32),
    status: view.status,
    action: view.action,
    taskTitle: view.taskTitle.slice(0, 200),
    taskSummary: view.taskSummary.slice(0, 1000),
    issueNumber: view.issueNumber,
    prNumber: view.prNumber,
    worktreeBranch: view.worktreeBranch.slice(0, 200),
    handRaised: handRaised(view.status),
    statusReason:
      view.status === "error" || view.status === "waiting_input"
        ? view.statusReason.slice(0, MAX_STATUS_REASON)
        : "",
    bubbleEmits: { ...view.bubbles },
    lastActivityAt: view.lastActivityAt,
  };
}

export interface ApplyResult {
  /** The status changed (persist it, refresh floor counters). */
  statusChanged: boolean;
  /** Anything the robot shows changed (republish it). */
  robotChanged: boolean;
  /** A requested status change was refused by the state machine. */
  refused?: { from: AgentStatus; to: AgentStatus };
}

/** Status the event asks for, if any. */
export function requestedStatus(event: AgentEvent): AgentStatus | undefined {
  switch (event.kind) {
    case "status":
      return event.status;
    case "permission_request":
      return "waiting_permission";
    case "tool_call":
      return event.status === "pending" || event.status === "running" ? "working" : undefined;
    case "exit":
      return "exited";
    default:
      return undefined;
  }
}

function actionFor(status: AgentStatus, current: AgentAction): AgentAction {
  switch (status) {
    case "working":
      return current === "celebrating" || current === "failing" ? "typing" : current;
    case "done":
      return "celebrating";
    case "error":
      return "failing";
    default:
      return "none";
  }
}

function remember(set: Set<string>, id: string): boolean {
  if (set.has(id)) return false;
  if (set.size >= MAX_SEEN_CALLS) set.clear();
  set.add(id);
  return true;
}

/**
 * The reason a robot shows: an error's safe reason, or one of the fixed
 * "waiting for you" reasons an adapter gives (e.g. Claude needs its human to
 * finish signing in, #158). Other reasons stay internal.
 */
function statusReasonFor(status: AgentStatus, reason: string | undefined): string {
  if (status === "error") return safeReason(reason);
  if (status === "waiting_input" && reason && HUMAN_WAIT_REASONS.has(reason)) return reason;
  return "";
}

/** Fold one event into the view. Mutates `view`; `now` stamps `lastActivityAt`. */
export function applyEvent(view: AgentView, event: AgentEvent, now: number): ApplyResult {
  const before = JSON.stringify(robotState(view));
  const result: ApplyResult = { statusChanged: false, robotChanged: false };

  const wanted = requestedStatus(event);
  if (wanted) {
    const next = transition(view.status, wanted);
    if (next.refused) result.refused = { from: view.status, to: wanted };
    if (next.changed) {
      view.status = next.status;
      view.action = actionFor(next.status, view.action);
      view.statusReason = event.kind === "status" ? statusReasonFor(next.status, event.reason) : "";
      result.statusChanged = true;
    } else if (event.kind === "status" && wanted === view.status && wanted === "waiting_input") {
      // Still waiting, for something else now (e.g. sign-in done, trust dialog next).
      const reason = statusReasonFor(wanted, event.reason);
      if (reason) view.statusReason = reason;
    }
  }

  // Once the process is gone nothing but a resume changes the robot.
  const settled = view.status === "exited" || view.status === "offline";
  if (!settled) {
    switch (event.kind) {
      case "action":
        view.action = event.action;
        break;
      case "message":
        if (event.role === "assistant" && view.status === "working") view.action = "typing";
        if (event.role === "thought" && view.status === "working") view.action = "thinking";
        break;
      case "tool_call":
        applyToolCall(view, event);
        break;
    }
    if (event.kind !== "usage" && event.kind !== "limit") view.lastActivityAt = now;
  }

  result.robotChanged = before !== JSON.stringify(robotState(view));
  return result;
}

function applyToolCall(view: AgentView, event: Extract<AgentEvent, { kind: "tool_call" }>): void {
  if (remember(view.seenCalls, event.callId)) {
    view.bubbles.toolCalls++;
    if (event.toolKind === "edit" || event.toolKind === "delete" || event.toolKind === "move") {
      view.bubbles.fileEdits++;
    }
    if (event.toolKind === "execute" && TEST_COMMAND.test(`${event.name} ${event.summary ?? ""}`)) {
      view.bubbles.testRuns++;
    }
  }
  if (event.status === "failed") {
    if (remember(view.failedCalls, event.callId)) view.bubbles.toolFailures++;
    view.action = "failing";
    return;
  }
  if (event.status === "pending" || event.status === "running") {
    const isTest =
      event.toolKind === "execute" && TEST_COMMAND.test(`${event.name} ${event.summary ?? ""}`);
    view.action = isTest ? "running_tests" : TOOL_ACTIONS[event.toolKind];
  }
}

/** A manager-initiated status change (offline, resume), still through the state machine. */
export function setStatus(view: AgentView, status: AgentStatus, now: number): boolean {
  const next = transition(view.status, status);
  if (!next.changed) return false;
  view.status = next.status;
  view.action = actionFor(next.status, view.action);
  view.statusReason = "";
  view.lastActivityAt = now;
  return true;
}
