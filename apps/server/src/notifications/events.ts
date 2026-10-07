/**
 * What a notification is about (#42): a henchman, reduced to the fields a
 * notification may carry. Terminal output, prompts, permission requests,
 * status reasons and tokens are not in here, so no formatter can leak them.
 */
import type { AgentStatus, NotificationEvent, ProviderId } from "@regulus/protocol";

/** The slice of an AgentView (agents/manager/henchman.ts) notifications read. */
export interface HenchmanSnapshot {
  agentId: string;
  /** The henchman's own name (#256); "" for one not named yet. */
  name: string;
  operationId: string;
  repoId: string;
  ownerUserId: string;
  ownerName: string;
  provider: ProviderId;
  status: AgentStatus;
  taskTitle: string;
  prNumber: number;
}

/** A henchman event about to be delivered, with the names resolved. */
export interface HenchmanNotice {
  /** Unique per delivery (dedupe on the client). */
  id: string;
  event: NotificationEvent;
  agentId: string;
  operationId: string;
  operationName: string;
  ownerUserId: string;
  ownerName: string;
  henchmanName: string;
  provider: ProviderId;
  taskTitle: string;
  prNumber: number;
  /** https link to the pull request, or "". */
  prUrl: string;
  ts: number;
}

/** The status-driven events; PR events come from their own sources. */
export function eventForStatus(status: AgentStatus): NotificationEvent | null {
  switch (status) {
    case "waiting_input":
      return "needs_input";
    case "waiting_permission":
      return "needs_permission";
    case "done":
      return "done";
    case "error":
      return "error";
    default:
      return null;
  }
}

/**
 * After the settle delay: is the event still true? A henchman that asked and
 * went back to work within the delay, or errored and was resumed, sends
 * nothing.
 */
export function eventStillHolds(
  event: NotificationEvent,
  status: AgentStatus | undefined,
): boolean {
  switch (event) {
    case "needs_input":
      return status === "waiting_input";
    case "needs_permission":
      return status === "waiting_permission";
    case "done":
      return status === "done" || status === "idle";
    case "error":
      return status === "error";
    default:
      return true;
  }
}

/** Henchmen in these statuses wait for their human (tab badge). */
export const ATTENTION_STATUSES: readonly AgentStatus[] = ["waiting_input", "waiting_permission"];
