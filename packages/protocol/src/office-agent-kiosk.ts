/**
 * Board helpers, the kiosk agents (SPEC §10 M5, D10, D20, D37; #56): a small
 * shared office agent that stands at one board of one project room (the issue
 * board, the pull request board or the queue clipboard), briefs whoever walks
 * up, and can put a task on that room's queue for the person who asked.
 *
 * A board helper is an office agent with the `kiosk` job and a *placement*
 * (a room and a board), and it is restricted in three ways the server enforces:
 *
 * - tools: only `KIOSK_TOOLS` (office-agent-tools.ts), whatever its preset:
 *   it reads its room's boards, queue and henchmen and queues tasks; it never
 *   comments, posts chat, spawns, stops, asks people or keeps memories;
 * - reach: it may be let into its own room and no other;
 * - queueing: it queues nothing itself. Its `enqueue_task` makes a *proposal*
 *   (`TaskProposal`) for the person whose turn it is answering; that person
 *   is shown exactly what would be queued and queues it from their own
 *   browser, as themselves, on an office key. What a helper reads on a board
 *   is other people's text, so nothing it decides alone starts a henchman;
 * - visibility (D26, D27, D34): its card, its body, its brief and its chat
 *   exist only for people whose own GitHub access opens its room. For
 *   everyone else, office owners and admins included, there is no such agent.
 *
 * The brief is made by the office from the board as it is (no model runs for
 * it), so walking up to a helper costs nothing; a question typed to it is a
 * normal office agent conversation.
 */
import { z } from "zod";
import { GhNumber, Id, PROMPT_MAX, TimestampMs } from "./common.ts";
import { PROVIDER_IDS, TASK_KINDS } from "./enums.ts";

export const KIOSK_BOARDS = ["issues", "pulls", "queue"] as const;
export type KioskBoard = (typeof KIOSK_BOARDS)[number];

export const KIOSK_BOARD_LABELS: Readonly<Record<KioskBoard, string>> = {
  issues: "Issue board",
  pulls: "Pull request board",
  queue: "Task queue",
};

/**
 * The post a helper stands at, named after the wall anchor of its board
 * (`@regulus/room-layout` `WallAnchorKind`). `OFFICE_AGENT_POSTS` includes them.
 */
export const KIOSK_POSTS = ["issue_board", "pr_board", "queue_clipboard"] as const;
export type KioskPost = (typeof KIOSK_POSTS)[number];

export const KIOSK_BOARD_POST: Readonly<Record<KioskBoard, KioskPost>> = {
  issues: "issue_board",
  pulls: "pr_board",
  queue: "queue_clipboard",
};

/** The board a post belongs to; undefined for `none`, `reception` and anything unknown. */
export function kioskBoardOfPost(post: string | undefined): KioskBoard | undefined {
  return KIOSK_BOARDS.find((board) => KIOSK_BOARD_POST[board] === post);
}

/** How much smaller than a henchman a board helper is drawn ("small restricted henchmen"). */
export const KIOSK_BODY_SCALE = 0.8;

/** Where a helper stands: one board of one project room. One helper per board. */
export const KioskPlacement = z.object({
  operationId: Id,
  board: z.enum(KIOSK_BOARDS),
  /**
   * Run its turns on the office PM's key and model while the office has a PM
   * that runs as a session in the office (SPEC §10 M5: "as PM agent sub-tasks
   * where the PM is configured"); its own choice is used otherwise.
   */
  viaPm: z.boolean().default(true),
});
export type KioskPlacement = z.infer<typeof KioskPlacement>;

/** The placement as a card shows it, with the room's name. Only ever sent to people who see that room. */
export const KioskPlacementView = z.object({
  operationId: Id,
  operationName: z.string().max(200),
  board: z.enum(KIOSK_BOARDS),
  viaPm: z.boolean(),
  /** Its turns run on the office PM's key and model right now. */
  runsLikePm: z.boolean(),
});
export type KioskPlacementView = z.infer<typeof KioskPlacementView>;

export const KIOSK_BRIEF_LIMITS = { linesMax: 8, lineMax: 160 } as const;

/** What a helper tells whoever walks up: the board in a headline and a few lines. */
export const KioskBrief = z.object({
  agentId: Id,
  operationId: Id,
  operationName: z.string().max(200),
  board: z.enum(KIOSK_BOARDS),
  headline: z.string().max(200),
  lines: z.array(z.string().max(KIOSK_BRIEF_LIMITS.lineMax)).max(KIOSK_BRIEF_LIMITS.linesMax),
  /** The helper can queue a task for this viewer: its preset, its room access and theirs allow it. */
  canEnqueue: z.boolean(),
  generatedAt: TimestampMs,
});
export type KioskBrief = z.infer<typeof KioskBrief>;

// ---- Task proposals -----------------------------------------------------------

export const TASK_PROPOSAL_STATUSES = ["pending", "confirmed", "dismissed"] as const;
export type TaskProposalStatus = (typeof TASK_PROPOSAL_STATUSES)[number];

export const TASK_PROPOSAL_LIMITS = {
  /** A proposal nobody confirmed is dead after this long. */
  ttlMs: 15 * 60_000,
  /** Open proposals one helper may hold for one person; the oldest goes when another is made. */
  openPerPerson: 3,
} as const;

/** The task exactly as it would be queued. Everything in it is shown to the person. */
export const TaskProposalTask = z.object({
  operationId: Id,
  repoId: Id,
  kind: z.enum(TASK_KINDS),
  refNumber: GhNumber.optional(),
  title: z.string().max(200).optional(),
  /** The prompt the henchman would get; absent for an issue or PR task that uses the office's own. */
  prompt: z.string().max(PROMPT_MAX).optional(),
  provider: z.enum(PROVIDER_IDS),
  model: z.string().max(100),
  effort: z.string().max(32).optional(),
});
export type TaskProposalTask = z.infer<typeof TaskProposalTask>;

export const TaskProposal = z.object({
  id: Id,
  agentId: Id,
  agentName: z.string(),
  operationName: z.string().max(200),
  /** `owner/name` of the repo the henchman would work in. */
  repo: z.string().max(300),
  /** The card's title as the office has it, for an issue or PR task; empty when it has no such card. */
  cardTitle: z.string().max(300),
  task: TaskProposalTask,
  status: z.enum(TASK_PROPOSAL_STATUSES),
  createdAt: TimestampMs,
  expiresAt: TimestampMs,
});
export type TaskProposal = z.infer<typeof TaskProposal>;

export const TaskProposalsResponse = z.object({ proposals: z.array(TaskProposal) });
export const TaskProposalConfirmed = z.object({ taskId: Id });
