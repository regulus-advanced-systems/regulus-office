/**
 * A linked task as one viewer may see it (#257; D26, D27): only the parts in
 * rooms open to them, and nothing at all unless that is at least two. The
 * combined state is computed over those parts, so neither a count nor a state
 * tells of a part the viewer cannot see.
 */
import {
  LINKED_NOTE_MAX_CHARS,
  LINKED_TASK_PARTS_MIN,
  type LinkedPullState,
  type LinkedTaskPart,
  LinkedTaskView,
  linkedPullsState,
  linkedWorkState,
  type OperationAccess,
} from "@regulus/protocol";
import type { LinkedNoteRow, LinkedTaskRow, PartRow } from "./store.ts";

/** The pull request's page: from the cached GitHub payload, else from the repo's own URL. */
export function pullUrl(part: PartRow): string {
  const number = part.task.prNumber;
  if (!number) return "";
  if (part.pull) {
    try {
      const url = (JSON.parse(part.pull.raw) as { html_url?: unknown }).html_url;
      if (typeof url === "string" && /^https?:\/\//.test(url)) return url.slice(0, 512);
    } catch {
      // fall through to the repo URL
    }
  }
  const base = part.repo?.url ?? "";
  if (!/^https?:\/\//.test(base)) return "";
  return `${base.replace(/\.git$/, "").replace(/\/+$/, "")}/pull/${number}`.slice(0, 512);
}

export function pullState(part: PartRow): LinkedPullState {
  if (!part.task.prNumber) return "none";
  // Linked but not in the board cache yet: it was just opened.
  if (!part.pull) return "open";
  let merged = false;
  try {
    const raw = JSON.parse(part.pull.raw) as { merged?: unknown; merged_at?: unknown };
    merged = raw.merged === true || typeof raw.merged_at === "string";
  } catch {
    merged = false;
  }
  if (merged) return "merged";
  if (part.pull.state !== "open") return "closed";
  return part.pull.isDraft ? "draft" : "open";
}

export function toPart(part: PartRow): LinkedTaskPart {
  const { task } = part;
  return {
    taskId: task.id,
    operationId: task.operationId,
    roomName: part.roomName.slice(0, 200),
    repo: part.repo ? `${part.repo.owner}/${part.repo.name}`.slice(0, 300) : "",
    state: task.state,
    reason: task.reason.slice(0, 200),
    agentId: task.agentId ?? "",
    henchmanName: (part.agent?.name ?? "").slice(0, 64),
    prNumber: task.prNumber ?? 0,
    prUrl: pullUrl(part),
    prState: pullState(part),
    prNote: task.prNumber ? "" : task.prNote.slice(0, 200),
  };
}

/** The view for one person, or null when they may not know the task is linked. */
export function viewFor(input: {
  linked: LinkedTaskRow;
  parts: readonly PartRow[];
  viewerId: string;
  ownerName: string;
  /** The viewer's access to every room open to them. */
  access: ReadonlyMap<string, OperationAccess>;
  /** The task's notes; shown to its owner only, and only those of parts they may see. */
  notes: readonly LinkedNoteRow[];
}): LinkedTaskView | null {
  const visible = input.parts.filter((p) => input.access.has(p.task.operationId));
  if (visible.length < LINKED_TASK_PARTS_MIN) return null;
  const parts = visible.map(toPart);
  const owns = input.linked.createdBy === input.viewerId;
  const unfinished = input.parts.some(
    (p) => p.task.state === "queued" || p.task.state === "running",
  );
  const seen = new Set(parts.map((p) => p.taskId));
  return LinkedTaskView.parse({
    id: input.linked.id,
    title: input.linked.title.slice(0, 200),
    createdBy: input.linked.createdBy,
    ownerName: input.ownerName.slice(0, 64),
    parts,
    work: linkedWorkState(parts),
    pulls: linkedPullsState(parts),
    mayStop: owns && unfinished,
    ...(owns
      ? {
          autoNotes: input.linked.releaseNotes,
          notes: input.notes
            .filter((n) => seen.has(n.taskId))
            .map((n) => ({
              id: n.id,
              taskId: n.taskId,
              body: n.body.slice(0, LINKED_NOTE_MAX_CHARS),
              createdAt: n.createdAt.getTime(),
              releasedAt: n.releasedAt ? n.releasedAt.getTime() : 0,
            })),
        }
      : {}),
  });
}
