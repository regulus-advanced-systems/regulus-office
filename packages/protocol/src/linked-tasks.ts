/**
 * One task across several repos (#257; D7: one repo per room, so work that
 * touches two repos is one *linked task* with a part in each room).
 *
 * A linked task is 2 to {@link LINKED_TASK_PARTS_MAX} ordinary queue tasks
 * (queue-api.ts), one per room on the same level, with the same owner, text
 * and model. Each part waits in its own room's queue, gets its own henchman,
 * desk, worktree and (draft) pull request.
 *
 * Access (D26, D27, D34):
 * - creating one needs `spawn`/`manage` (GitHub write) in **every** room named;
 * - a person sees a part only when they can see its room, and sees the task as
 *   linked only when they can see at least two of its parts. With one visible
 *   part it is an ordinary task: nothing in the room's live state or in this
 *   API says it belongs to more. Counts and the combined state are computed
 *   over the visible parts only;
 * - the whole task is stopped by its owner only; a part is cancelled in its
 *   room by the queue's own rules, and the other parts carry on.
 *
 * Notes: a part's henchman may leave notes for the task's owner in a file in
 * its worktree. The office shows them to the owner alone. Nothing a henchman
 * writes in one room reaches another room by itself: a note is copied to the
 * other parts only when the owner releases it, because everyone who may watch
 * a henchman there (its terminal, its files) can then read it. The owner may
 * turn on automatic release for a task; it is off by default.
 *
 * - `GET  /api/linked-tasks?operationId=`      linked tasks with a part in that room, as the viewer may see them
 * - `POST /api/linked-tasks`                   create (write access to every room)
 * - `POST /api/linked-tasks/:id/stop`          stop every unfinished part (the owner)
 * - `POST /api/linked-tasks/:id/notes/:noteId/release`  pass one note on (the owner)
 * - `PUT  /api/linked-tasks/:id/notes/auto`    `{ on }`: release automatically (the owner)
 */
import { z } from "zod";
import { Count, Effort, Id, ModelName, PromptText, ShortText, TimestampMs } from "./common.ts";
import { PROVIDER_IDS, TASK_STATES, type TaskState } from "./enums.ts";
import { PermissionModeSchema } from "./permission-modes.ts";

export const LINKED_TASKS_API_PATH = "/api/linked-tasks";
const one = (id: string) => `${LINKED_TASKS_API_PATH}/${encodeURIComponent(id)}`;
export const linkedTaskStopPath = (id: string) => `${one(id)}/stop`;
export const linkedTaskAutoNotesPath = (id: string) => `${one(id)}/notes/auto`;
export const linkedNoteReleasePath = (id: string, noteId: string) =>
  `${one(id)}/notes/${encodeURIComponent(noteId)}/release`;

export const LINKED_TASK_PARTS_MIN = 2;
export const LINKED_TASK_PARTS_MAX = 6;

/** The office's directory in a part's worktree (never committed). */
export const LINKED_NOTES_DIR = ".office";
/** Where a part's henchman leaves notes for the task's owner. */
export const LINKED_NOTES_FILE = `${LINKED_NOTES_DIR}/notes.md`;
/** Where the office puts the notes the owner passed on to this part. */
export const LINKED_INBOX_FILE = `${LINKED_NOTES_DIR}/inbox.md`;
/** Notes are short. One note, and all the notes the office keeps of one part. */
export const LINKED_NOTE_MAX_CHARS = 4_000;
export const LINKED_PART_NOTES_MAX_CHARS = 16_000;

export const CreateLinkedTaskRequest = z.object({
  /** The rooms (one repo each), all on one level; the order is the order of the parts. */
  operationIds: z.array(Id).min(LINKED_TASK_PARTS_MIN).max(LINKED_TASK_PARTS_MAX),
  title: ShortText.optional(),
  /** The task text every part's henchman gets. */
  prompt: PromptText,
  provider: z.enum(PROVIDER_IDS),
  model: ModelName,
  effort: Effort.optional(),
  permissionMode: PermissionModeSchema.optional(),
  profileId: Id.optional(),
  /**
   * Each pull request names the other parts' pull requests in public repos.
   * With this on it names those in private repos too (never in a public
   * repo's pull request): everyone who can read one of the private repos on
   * GitHub then sees the others' names.
   */
  namePrivateRepos: z.boolean().default(false),
});
export type CreateLinkedTaskRequest = z.input<typeof CreateLinkedTaskRequest>;

export const SetLinkedAutoNotesRequest = z.object({ on: z.boolean() });
export type SetLinkedAutoNotesRequest = z.infer<typeof SetLinkedAutoNotesRequest>;

export const LINKED_PULL_STATES = ["none", "draft", "open", "merged", "closed"] as const;
export type LinkedPullState = (typeof LINKED_PULL_STATES)[number];

export const LinkedTaskPart = z.object({
  taskId: Id,
  operationId: Id,
  roomName: z.string().max(200),
  /** `owner/name`. */
  repo: z.string().max(300),
  state: z.enum(TASK_STATES),
  /** Why the part failed, was cancelled or is waiting; safe for every viewer of its room. */
  reason: z.string().max(200),
  /** "" until the part starts. */
  agentId: z.string().max(128),
  henchmanName: z.string().max(64),
  /** 0 until the part has a pull request. */
  prNumber: Count,
  prUrl: z.string().max(512),
  prState: z.enum(LINKED_PULL_STATES),
  /** Why the office opened no draft pull request for a finished part ("" otherwise). */
  prNote: z.string().max(200),
});
export type LinkedTaskPart = z.infer<typeof LinkedTaskPart>;

/** A note a part's henchman left for the owner. */
export const LinkedTaskNote = z.object({
  id: Id,
  /** The part it came from. */
  taskId: Id,
  body: z.string().max(LINKED_NOTE_MAX_CHARS),
  createdAt: TimestampMs,
  /** 0 until it was passed on to the other parts. */
  releasedAt: TimestampMs,
});
export type LinkedTaskNote = z.infer<typeof LinkedTaskNote>;

export const LINKED_WORK_STATES = ["queued", "working", "finished", "attention"] as const;
/** `attention`: nothing is running any more and a part failed or was cancelled. */
export type LinkedWorkState = (typeof LINKED_WORK_STATES)[number];

export const LINKED_PULLS_STATES = [
  "none",
  "some_open",
  "all_open",
  "some_merged",
  "all_merged",
] as const;
export type LinkedPullsState = (typeof LINKED_PULLS_STATES)[number];

export const LinkedTaskView = z.object({
  id: Id,
  title: z.string().max(200),
  createdBy: Id,
  ownerName: z.string().max(64),
  /** Only the parts this viewer may see (at least two), in the task's order. */
  parts: z.array(LinkedTaskPart).min(LINKED_TASK_PARTS_MIN).max(LINKED_TASK_PARTS_MAX),
  work: z.enum(LINKED_WORK_STATES),
  pulls: z.enum(LINKED_PULLS_STATES),
  /** The viewer owns the task and a part is still queued or running. */
  mayStop: z.boolean(),
  /**
   * For the task's owner only (absent for everyone else): the notes of the
   * parts they may see, oldest first, and whether notes are passed on
   * without asking.
   */
  notes: z.array(LinkedTaskNote).optional(),
  autoNotes: z.boolean().optional(),
});
export type LinkedTaskView = z.infer<typeof LinkedTaskView>;

export const LinkedTaskListResponse = z.object({ tasks: z.array(LinkedTaskView) });
export type LinkedTaskListResponse = z.infer<typeof LinkedTaskListResponse>;

export const LinkedTaskCreated = z.object({ id: Id, taskIds: z.array(Id) });
export type LinkedTaskCreated = z.infer<typeof LinkedTaskCreated>;

export const LinkedTaskStopped = z.object({
  id: Id,
  /** Parts that were queued or running and are stopped now. */
  stopped: Count,
  /** Running parts whose henchman could not be stopped; they carry on. */
  refused: Count,
});
export type LinkedTaskStopped = z.infer<typeof LinkedTaskStopped>;

export const LinkedTaskOk = z.object({ id: Id });
export type LinkedTaskOk = z.infer<typeof LinkedTaskOk>;

type PartState = { state: TaskState; prState: LinkedPullState };

/** How the work stands over these parts. */
export function linkedWorkState(parts: readonly PartState[]): LinkedWorkState {
  if (parts.some((p) => p.state === "running")) return "working";
  if (parts.every((p) => p.state === "queued")) return "queued";
  if (parts.some((p) => p.state === "queued")) return "working";
  return parts.every((p) => p.state === "done") ? "finished" : "attention";
}

/** The pull requests of these parts as one state: all open, some merged, all merged. */
export function linkedPullsState(parts: readonly PartState[]): LinkedPullsState {
  const merged = parts.filter((p) => p.prState === "merged").length;
  const open = parts.filter((p) => p.prState === "open" || p.prState === "draft").length;
  if (parts.length > 0 && merged === parts.length) return "all_merged";
  if (merged > 0) return "some_merged";
  if (parts.length > 0 && open === parts.length) return "all_open";
  return open > 0 ? "some_open" : "none";
}

const PULLS_LABELS: Record<LinkedPullsState, string> = {
  none: "no pull requests yet",
  some_open: "some pull requests open",
  all_open: "all pull requests open",
  some_merged: "some merged",
  all_merged: "all merged",
};

/** One line for a card or a bubble: `2 of 3 merged`, `all pull requests open`, `1 part failed`. */
export function linkedTaskSummary(parts: readonly PartState[]): string {
  const total = parts.length;
  const pulls = linkedPullsState(parts);
  const merged = parts.filter((p) => p.prState === "merged").length;
  const open = parts.filter((p) => p.prState === "open" || p.prState === "draft").length;
  let line = PULLS_LABELS[pulls];
  if (pulls === "some_merged") line = `${merged} of ${total} merged`;
  if (pulls === "some_open") line = `${open} of ${total} pull requests open`;
  const failed = parts.filter((p) => p.state === "failed").length;
  const cancelled = parts.filter((p) => p.state === "cancelled").length;
  const notes: string[] = [];
  if (failed > 0) notes.push(`${failed} ${failed === 1 ? "part" : "parts"} failed`);
  if (cancelled > 0) notes.push(`${cancelled} stopped`);
  return [line, ...notes].join(" · ");
}
