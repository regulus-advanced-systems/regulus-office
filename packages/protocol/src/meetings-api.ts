/**
 * Meeting room REST and live shapes (#50, SPEC §10 M3, D9; patterns and the
 * agenda in meeting-plan.ts).
 *
 * A meeting belongs to one operation and one of its repos. Its starter spawns
 * every member henchman in their own runner with their own credentials
 * (SPEC §8), so the members are the starter's henchmen: only the starter
 * controls the meeting and its henchmen, everyone with access to the
 * operation watches (D12); an office owner/admin may only emergency-stop it.
 * The members share one worktree on a meeting branch in the starter's own
 * area of the operation (D17) with a `.meeting/` notes directory.
 *
 * - `GET  /api/meetings?operationId=` meetings of an operation (view access)
 * - `GET  /api/meetings/active`        live meetings the viewer may see (door signs)
 * - `POST /api/meetings`               start (operation `spawn`/`manage`)
 * - `GET  /api/meetings/:id`           detail with the transcript (view access)
 * - `POST /api/meetings/:id/pause|resume|stop` starter; `stop` also office owner/admin
 *
 * Every change is broadcast on the operation's room as `meeting.changed`.
 */
import { z } from "zod";
import { Count, Effort, GhNumber, Id, ModelName, PROMPT_MAX, TimestampMs } from "./common.ts";
import { AGENT_STATUSES, PROVIDER_IDS } from "./enums.ts";
import {
  MEETING_MEMBERS_MAX,
  MEETING_MEMBERS_MIN,
  MEETING_PATTERNS,
  MEETING_ROLES,
  MEETING_ROUNDS_MAX,
  MEETING_ROUNDS_MIN,
  MEETING_TURN_KINDS,
} from "./meeting-plan.ts";
import { PermissionModeSchema } from "./permission-modes.ts";

export const MEETINGS_API_PATH = "/api/meetings";
export const MEETINGS_ACTIVE_PATH = `${MEETINGS_API_PATH}/active`;
export const meetingPath = (id: string) => `${MEETINGS_API_PATH}/${encodeURIComponent(id)}`;
export const MEETING_ACTIONS = ["pause", "resume", "stop"] as const;
export type MeetingAction = (typeof MEETING_ACTIONS)[number];
export const meetingActionPath = (id: string, action: MeetingAction) =>
  `${meetingPath(id)}/${action}`;

/** OperationRoom broadcast: a meeting on that operation changed (payload `MeetingSummary`). */
export const MEETING_CHANGED_MESSAGE = "meeting.changed";

export const MEETING_STATUSES = [
  /** Preparing the worktree and spawning the members. */
  "starting",
  "running",
  /** Held by the starter or by a failed turn; `resume` continues at the unfinished step. */
  "paused",
  "done",
  "stopped",
  "failed",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export const LIVE_MEETING_STATUSES: readonly MeetingStatus[] = ["starting", "running", "paused"];
export const isLiveMeeting = (status: MeetingStatus) => LIVE_MEETING_STATUSES.includes(status);

/**
 * What the closing turn produces: the meeting branch pushed and opened as a
 * draft PR (through the one-click PR path), a review posted on PR `prNumber`,
 * or only the notes (transcript) kept in the office.
 */
export const MEETING_OUTPUTS = ["pull_request", "pr_review", "notes"] as const;
export type MeetingOutput = (typeof MEETING_OUTPUTS)[number];

export const MEETING_TURN_STATUSES = ["running", "done", "failed"] as const;
export type MeetingTurnStatus = (typeof MEETING_TURN_STATUSES)[number];

export const MEETING_LIMITS = {
  tokenBudgetMin: 10_000,
  tokenBudgetMax: 50_000_000,
  tokenBudgetDefault: 2_000_000,
  roundsDefault: 2,
  turnTimeoutMinutesMin: 1,
  turnTimeoutMinutesMax: 120,
  turnTimeoutMinutesDefault: 20,
  /** A turn's notes as kept and shown (longer ones are cut). */
  turnTextMax: 20_000,
  /** Finished meetings an operation still lists, newest first. */
  historyLimit: 10,
} as const;

export const MeetingMemberInput = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: ModelName,
  effort: Effort.optional(),
  permissionMode: PermissionModeSchema.optional(),
  /** The starter's own credential profile or `office:<provider>`; never a secret (SPEC §8). */
  profileId: Id.optional(),
});
export type MeetingMemberInput = z.infer<typeof MeetingMemberInput>;

export const StartMeetingRequest = z
  .object({
    operationId: Id,
    repoId: Id,
    pattern: z.enum(MEETING_PATTERNS),
    /** The task the meeting works on. */
    topic: z.string().trim().min(1).max(PROMPT_MAX),
    members: z.array(MeetingMemberInput).min(MEETING_MEMBERS_MIN).max(MEETING_MEMBERS_MAX),
    rounds: z
      .number()
      .int()
      .min(MEETING_ROUNDS_MIN)
      .max(MEETING_ROUNDS_MAX)
      .default(MEETING_LIMITS.roundsDefault),
    /** Input + output tokens of every member together; the meeting stops when they are used up. */
    tokenBudget: z
      .number()
      .int()
      .min(MEETING_LIMITS.tokenBudgetMin)
      .max(MEETING_LIMITS.tokenBudgetMax)
      .default(MEETING_LIMITS.tokenBudgetDefault),
    turnTimeoutMinutes: z
      .number()
      .int()
      .min(MEETING_LIMITS.turnTimeoutMinutesMin)
      .max(MEETING_LIMITS.turnTimeoutMinutesMax)
      .default(MEETING_LIMITS.turnTimeoutMinutesDefault),
    output: z.enum(MEETING_OUTPUTS).default("pull_request"),
    /** The pull request a review panel reviews, or a `pr_review` output posts on. */
    prNumber: GhNumber.optional(),
  })
  .refine((m) => m.pattern !== "review_panel" || m.output === "pr_review", {
    message: "a review panel posts a PR review",
    path: ["output"],
  })
  .refine((m) => m.output !== "pr_review" || m.prNumber !== undefined, {
    message: "a PR review needs the pull request number",
    path: ["prNumber"],
  });
export type StartMeetingRequest = z.input<typeof StartMeetingRequest>;
export type StartMeetingInput = z.output<typeof StartMeetingRequest>;

export const MeetingMemberView = z.object({
  position: Count,
  role: z.enum(MEETING_ROLES),
  /** Shown in the transcript and on the turn files, e.g. `Judge`, `Reviewer 2`. */
  name: z.string().max(40),
  /** Empty until spawned, or after the henchman went home. */
  agentId: z.string().max(128),
  seatId: z.string().max(128),
  provider: z.enum(PROVIDER_IDS),
  model: z.string().max(100),
  /** The henchman's status while it is at its desk; `offline` once it went home. */
  status: z.enum(AGENT_STATUSES),
});
export type MeetingMemberView = z.infer<typeof MeetingMemberView>;

export const MeetingSummary = z.object({
  id: Id,
  operationId: Id,
  repoId: Id,
  pattern: z.enum(MEETING_PATTERNS),
  /** First line of the topic, capped. */
  title: z.string().max(200),
  status: z.enum(MEETING_STATUSES),
  /** Why it paused, stopped or failed, or what the output was; safe to show. */
  reason: z.string().max(500),
  startedBy: Id,
  starterName: z.string().max(64),
  round: Count,
  rounds: Count,
  /** Steps finished, and steps in the agenda. */
  step: Count,
  steps: Count,
  tokensUsed: Count,
  tokenBudget: Count,
  output: z.enum(MEETING_OUTPUTS),
  prNumber: Count,
  branch: z.string().max(200),
  /** The draft PR or the posted review, once there is one. */
  outputUrl: z.string().max(500),
  members: z.array(MeetingMemberView),
  /** Positions of the members whose turn it is. */
  speaking: z.array(Count),
  createdAt: TimestampMs,
  updatedAt: TimestampMs,
  finishedAt: TimestampMs,
});
export type MeetingSummary = z.infer<typeof MeetingSummary>;

export const MeetingTurnView = z.object({
  step: Count,
  round: Count,
  position: Count,
  kind: z.enum(MEETING_TURN_KINDS),
  status: z.enum(MEETING_TURN_STATUSES),
  /** The henchman's notes for the turn (what it wrote to `.meeting/turns/`). */
  text: z.string().max(MEETING_LIMITS.turnTextMax + 100),
  tokens: Count,
  startedAt: TimestampMs,
  finishedAt: TimestampMs,
});
export type MeetingTurnView = z.infer<typeof MeetingTurnView>;

export const MeetingDetail = MeetingSummary.extend({
  topic: z.string().max(PROMPT_MAX),
  turns: z.array(MeetingTurnView),
  /** May the viewer pause, resume and stop it (the starter)? */
  canControl: z.boolean(),
  /** May the viewer emergency-stop it (an office owner/admin who is not the starter)? */
  canEmergencyStop: z.boolean(),
});
export type MeetingDetail = z.infer<typeof MeetingDetail>;

export const MeetingListResponse = z.object({
  /** Live meetings first, then the latest finished ones. */
  meetings: z.array(MeetingSummary),
  /** May the viewer start a meeting on this operation (`spawn` or `manage`)? */
  canStart: z.boolean(),
});
export type MeetingListResponse = z.infer<typeof MeetingListResponse>;

export const ActiveMeetingsResponse = z.object({ meetings: z.array(MeetingSummary) });
export type ActiveMeetingsResponse = z.infer<typeof ActiveMeetingsResponse>;
