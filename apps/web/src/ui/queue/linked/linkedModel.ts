/**
 * Linked tasks, client side (#257): how a part is worded in the queue, on a
 * henchman's name tag and on a PR card, and which rooms a task may also go
 * to. Pure. Everything here is built from what the server sent this viewer,
 * which is only the parts they may see.
 */
import {
  CreateLinkedTaskRequest,
  hasOperationAccess,
  type LinkedPullState,
  type LinkedTaskPart,
  type LinkedTaskView,
  linkedTaskSummary,
  type OperationInfo,
} from "@regulus/protocol";

const WORK_LABELS: Record<LinkedTaskView["work"], string> = {
  queued: "waiting",
  working: "at work",
  finished: "work done",
  attention: "needs a look",
};

const PULL_LABELS: Record<LinkedPullState, string> = {
  none: "no PR yet",
  draft: "draft",
  open: "open",
  merged: "merged",
  closed: "closed",
};

/** `Across 2 rooms · at work · 1 of 2 merged`. */
export function linkedHeadline(view: LinkedTaskView): string {
  return `Across ${view.parts.length} rooms · ${WORK_LABELS[view.work]} · ${linkedTaskSummary(view.parts)}`;
}

/** One part as a line: its state, its pull request, and why it has none or failed. */
export function partLine(part: LinkedTaskPart): { state: string; pull: string; note: string } {
  const state =
    part.state === "running" && part.henchmanName
      ? `${part.henchmanName} at work`
      : part.state === "cancelled"
        ? "stopped"
        : part.state;
  const pull = part.prNumber > 0 ? `PR #${part.prNumber} ${PULL_LABELS[part.prState]}` : "";
  return { state, pull, note: part.prNumber > 0 ? part.reason : part.reason || part.prNote };
}

export interface LinkedIndex {
  /** By the id of a part's queue task. */
  byTask: ReadonlyMap<string, LinkedTaskView>;
  /** By the id of a part's henchman. */
  byAgent: ReadonlyMap<string, LinkedTaskView>;
}

export const EMPTY_LINKED_INDEX: LinkedIndex = { byTask: new Map(), byAgent: new Map() };

export function indexLinked(views: readonly LinkedTaskView[]): LinkedIndex {
  const byTask = new Map<string, LinkedTaskView>();
  const byAgent = new Map<string, LinkedTaskView>();
  for (const view of views) {
    for (const part of view.parts) {
      byTask.set(part.taskId, view);
      if (part.agentId) byAgent.set(part.agentId, view);
    }
  }
  return { byTask, byAgent };
}

const NAME_TAG_MAX = 32;

/** A henchman's name tag when it works on a linked task: `Boris · with api, ops`. */
export function linkedNameTag(
  name: string,
  agentId: string,
  view: LinkedTaskView | undefined,
): string {
  if (!view) return name;
  const others = view.parts.filter((p) => p.agentId !== agentId).map((p) => p.roomName);
  if (others.length === 0) return name;
  const tag = `${name} · with ${others.join(", ")}`;
  return tag.length > NAME_TAG_MAX ? `${tag.slice(0, NAME_TAG_MAX - 1)}…` : tag;
}

/** Chips for this room's PR cards, by PR number (a room has one repo, D7). */
export function linkedPullChips(
  views: readonly LinkedTaskView[],
  operationId: string | null,
): Map<number, string> {
  const chips = new Map<number, string>();
  for (const view of views) {
    for (const part of view.parts) {
      if (part.operationId !== operationId || part.prNumber <= 0) continue;
      const others = view.parts.filter((p) => p !== part).map((p) => p.roomName);
      chips.set(part.prNumber, `Linked: ${others.join(", ")} · ${linkedTaskSummary(view.parts)}`);
    }
  }
  return chips;
}

export type LinkedRequestResult =
  | { ok: true; request: CreateLinkedTaskRequest }
  | { ok: false; error: string };

/** The queue dialog's (validated) form as a linked task over this room and the ticked ones. */
export function linkedRequest(
  spawn: {
    operationId: string;
    provider: CreateLinkedTaskRequest["provider"];
    model: string;
    prompt: string;
    taskTitle?: string;
    issueNumber?: number;
    effort?: string;
    permissionMode?: CreateLinkedTaskRequest["permissionMode"];
    profileId?: string;
  },
  also: { operationIds: readonly string[]; namePrivateRepos: boolean },
): LinkedRequestResult {
  if (spawn.issueNumber) {
    return {
      ok: false,
      error: "A task across rooms takes a prompt, not an issue: an issue belongs to one repo.",
    };
  }
  if (!spawn.prompt.trim()) {
    return { ok: false, error: "A task across rooms needs a prompt (under More options)." };
  }
  const request: CreateLinkedTaskRequest = {
    operationIds: [spawn.operationId, ...also.operationIds],
    ...(spawn.taskTitle ? { title: spawn.taskTitle } : {}),
    prompt: spawn.prompt,
    provider: spawn.provider,
    model: spawn.model,
    ...(spawn.effort ? { effort: spawn.effort } : {}),
    ...(spawn.permissionMode ? { permissionMode: spawn.permissionMode } : {}),
    ...(spawn.profileId ? { profileId: spawn.profileId } : {}),
    namePrivateRepos: also.namePrivateRepos,
  };
  if (!CreateLinkedTaskRequest.safeParse(request).success) {
    return { ok: false, error: "This task is not accepted." };
  }
  return { ok: true, request };
}

/**
 * The other rooms one task may also run in: on the same level as this room,
 * with a repo, where the viewer may work. The list comes from the viewer's own
 * room list, so it never holds a room they cannot see.
 */
export function linkableRooms(
  operations: readonly OperationInfo[] | null | undefined,
  operationId: string | null,
): OperationInfo[] {
  const here = operations?.find((o) => o.operationId === operationId);
  if (!here) return [];
  return (operations ?? []).filter(
    (o) =>
      o.operationId !== here.operationId &&
      o.levelId === here.levelId &&
      o.archivedAt === null &&
      o.repos.length > 0 &&
      hasOperationAccess(o.access, "spawn"),
  );
}
