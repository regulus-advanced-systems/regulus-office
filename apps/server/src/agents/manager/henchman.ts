/**
 * What the world shows of an agent (protocol `HenchmanState`), derived from the
 * persisted row plus the event stream: its name, status (through the state
 * machine), the desk animation (`action`), the raised hand, the bubble
 * counters and the bubble that says what it is doing (activity.ts, #256).
 */
import { HUMAN_WAIT_REASONS } from "@regulus/agent-adapters";
import {
  AGENT_NAME_MAX,
  type AgentAction,
  type AgentEvent,
  type AgentStatus,
  DEFAULT_SKIN_ID,
  effectivePermissionMode,
  type HenchmanState,
  type ProviderId,
  type ToolKind,
} from "@regulus/protocol";
import { activityOf, askOf, bubbleFor } from "./activity.ts";
import { MAX_STATUS_REASON, safeReason } from "./failure.ts";
import { handRaised, transition } from "./state-machine.ts";

export interface AgentView {
  agentId: string;
  /** The henchman's own name (D29); "" only for a row not named yet. */
  name: string;
  operationId: string;
  repoId: string;
  seatId: string;
  ownerUserId: string;
  ownerName: string;
  provider: ProviderId;
  model: string;
  effort: string;
  /** Permission mode the henchman runs in (#166); "" when the provider has none. */
  permissionMode: string;
  status: AgentStatus;
  /** Why the henchman is in `error` (safe to publish, failure.ts); "" otherwise. */
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
  /** Bubble words (activity.ts): what it does now, what it asks for, what it has to say at rest. */
  activity: string;
  ask: string;
  announce: string;
}

/** A fresh view of a persisted `agents` row (bubbles restart at zero). */
export function viewFromRow(
  row: {
    id: string;
    name?: string | null;
    operationId: string;
    repoId: string;
    deskSeatId: string;
    ownerUserId: string;
    provider: ProviderId;
    model: string;
    effort: string | null;
    permissionMode?: string | null;
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
    name: row.name ?? "",
    operationId: row.operationId,
    repoId: row.repoId,
    seatId: row.deskSeatId,
    ownerUserId: row.ownerUserId,
    ownerName,
    provider: row.provider,
    model: row.model,
    effort: row.effort ?? "",
    permissionMode: effectivePermissionMode(row.provider, row.permissionMode) ?? "",
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
    activity: "",
    ask: "",
    announce: "",
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

export function henchmanState(view: AgentView): HenchmanState {
  const statusReason =
    view.status === "error" || view.status === "waiting_input"
      ? view.statusReason.slice(0, MAX_STATUS_REASON)
      : "";
  return {
    agentId: view.agentId,
    name: view.name.slice(0, AGENT_NAME_MAX),
    ownerUserId: view.ownerUserId,
    ownerName: view.ownerName.slice(0, 64),
    repoId: view.repoId,
    seatId: view.seatId,
    provider: view.provider,
    model: view.model.slice(0, 100),
    effort: view.effort.slice(0, 32),
    permissionMode: view.permissionMode.slice(0, 32),
    status: view.status,
    action: view.action,
    taskTitle: view.taskTitle.slice(0, 200),
    taskSummary: view.taskSummary.slice(0, 1000),
    issueNumber: view.issueNumber,
    prNumber: view.prNumber,
    worktreeBranch: view.worktreeBranch.slice(0, 200),
    handRaised: handRaised(view.status),
    statusReason,
    // The OperationRoom publishes the skin the admin's rules give this henchman (#184).
    skin: DEFAULT_SKIN_ID,
    bubbleEmits: { ...view.bubbles },
    bubble: bubbleFor({
      agentId: view.agentId,
      status: view.status,
      activity: view.activity,
      ask: view.ask,
      announce: view.announce,
      statusReason,
    }),
    lastActivityAt: view.lastActivityAt,
  };
}

export interface ApplyResult {
  /** The status changed (persist it, refresh operation counters). */
  statusChanged: boolean;
  /** Anything the henchman shows changed (republish it). */
  henchmanChanged: boolean;
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
 * The reason a henchman shows: an error's safe reason, or one of the fixed
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
  const before = JSON.stringify(henchmanState(view));
  const result: ApplyResult = { statusChanged: false, henchmanChanged: false };

  const wanted = requestedStatus(event);
  if (wanted) {
    const next = transition(view.status, wanted);
    if (next.refused) result.refused = { from: view.status, to: wanted };
    if (next.changed) {
      restWords(view, view.status, next.status);
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

  // Once the process is gone nothing but a resume changes the henchman.
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
      case "permission_request":
        view.ask = askOf(event.toolName);
        break;
    }
    // What the bubble says it is doing (activity.ts); most events say nothing new.
    const activity = activityOf(event);
    if (activity) view.activity = activity;
    if (event.kind !== "usage" && event.kind !== "limit") view.lastActivityAt = now;
  }

  result.henchmanChanged = before !== JSON.stringify(henchmanState(view));
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

/**
 * The bubble's words on a status change: an answered request is gone; a new turn
 * drops what was announced at rest and starts by thinking; back at work after a
 * request or a question, it is still doing what it was doing.
 */
function restWords(view: AgentView, from: AgentStatus, to: AgentStatus): void {
  view.ask = "";
  if (to !== "working" && to !== "starting") return;
  view.announce = "";
  if (to === "starting") view.activity = "";
  else if (!handRaised(from) || !view.activity) view.activity = "thinking";
}

/** A manager-initiated status change (offline, resume), still through the state machine. */
export function setStatus(view: AgentView, status: AgentStatus, now: number): boolean {
  const next = transition(view.status, status);
  if (!next.changed) return false;
  restWords(view, view.status, next.status);
  view.status = next.status;
  view.action = actionFor(next.status, view.action);
  view.statusReason = "";
  view.lastActivityAt = now;
  return true;
}

/** The henchman's pull request is open: say so at rest (done, idle) until its next turn. */
export function announcePullRequest(view: AgentView, prNumber: number): void {
  view.prNumber = prNumber;
  view.announce = `opened PR #${prNumber}`;
}
