/**
 * FloorRoom state (SPEC §6 channel 2): robots, desks, decor, task queue,
 * board summaries, services, whiteboard version, carried cards. Shapes are
 * zod objects; the Colyseus classes in ./schema mirror them field-for-field.
 */
import { z } from "zod";
import { Count, GhNumber, Id, TimestampMs } from "./common.ts";
import {
  AGENT_ACTIONS,
  AGENT_STATUSES,
  CARD_KINDS,
  CHECKS_STATES,
  DECOR_KINDS,
  PROVIDER_IDS,
  REVIEW_STATES,
  TASK_KINDS,
  TASK_STATES,
} from "./enums.ts";

/** Counters behind the GDT-style work bubbles (SPEC §9.3), reset per task. */
export const BubbleEmits = z.object({
  toolCalls: Count,
  fileEdits: Count,
  testRuns: Count,
  toolFailures: Count,
});
export type BubbleEmits = z.infer<typeof BubbleEmits>;

/** One robot (agent) at a desk. Keyed by agent id in `FloorState.robots`. */
export const RobotState = z.object({
  agentId: Id,
  ownerUserId: Id,
  ownerName: z.string().max(64),
  repoId: Id,
  seatId: Id,
  provider: z.enum(PROVIDER_IDS),
  model: z.string().max(100),
  effort: z.string().max(32),
  /** Provider permission mode the robot runs in (#166), e.g. `auto`, `on-request`; "" = none. */
  permissionMode: z.string().max(32),
  status: z.enum(AGENT_STATUSES),
  action: z.enum(AGENT_ACTIONS),
  taskTitle: z.string().max(200),
  taskSummary: z.string().max(1000),
  /** 0 when the task is not bound to an issue / PR. */
  issueNumber: Count,
  prNumber: Count,
  worktreeBranch: z.string().max(200),
  /** True while waiting for permission or input (raised-hand animation). */
  handRaised: z.boolean(),
  /**
   * Why the robot is in `error`, e.g. `runner_busy: the runner has live work …`: a short
   * code and a redacted one-line message, safe for every floor viewer (no paths, env or
   * tokens). In `waiting_input`, one of the adapters' fixed "waiting for you" texts (e.g.
   * Claude needs its human to finish signing in, #158). Empty in every other status.
   */
  statusReason: z.string().max(200),
  bubbleEmits: BubbleEmits,
  lastActivityAt: TimestampMs,
});
export type RobotState = z.infer<typeof RobotState>;

/** Seat from the floor layout; `agentId` is empty while the desk is free. */
export const DeskState = z.object({
  seatId: Id,
  agentId: z.string().max(128),
});
export type DeskState = z.infer<typeof DeskState>;

export const DecorState = z.object({
  id: Id,
  kind: z.enum(DECOR_KINDS),
  wallId: Id,
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive(),
  h: z.number().positive(),
  /** Server-relative URL of the uploaded image. */
  imageUrl: z.string().max(512),
  placedBy: Id,
});
export type DecorState = z.infer<typeof DecorState>;

export const QueueTask = z.object({
  id: Id,
  position: Count,
  kind: z.enum(TASK_KINDS),
  /** Issue / PR number for `issue` and `pr` tasks, 0 for freeform. */
  refNumber: Count,
  repoId: Id,
  prompt: z.string().max(20_000),
  provider: z.enum(PROVIDER_IDS),
  model: z.string().max(100),
  effort: z.string().max(32),
  autoWorktree: z.boolean(),
  state: z.enum(TASK_STATES),
  /** Agent running the task, empty until it starts. */
  agentId: z.string().max(128),
  createdBy: Id,
  createdAt: TimestampMs,
});
export type QueueTask = z.infer<typeof QueueTask>;

const cardBase = {
  repoId: Id,
  number: GhNumber,
  title: z.string().max(300),
  /** GitHub state string: `open` or `closed` (merged PRs are `closed` + `merged`). */
  state: z.string().max(16),
  labels: z.array(z.string().max(64)),
  assignees: z.array(z.string().max(64)),
  author: z.string().max(64),
  url: z.string().max(512),
  updatedAt: TimestampMs,
};

export const IssueCard = z.object(cardBase);
export type IssueCard = z.infer<typeof IssueCard>;

export const PullCard = z.object({
  ...cardBase,
  draft: z.boolean(),
  merged: z.boolean(),
  headBranch: z.string().max(200),
  checksState: z.enum(CHECKS_STATES),
  reviewState: z.enum(REVIEW_STATES),
});
export type PullCard = z.infer<typeof PullCard>;

/** A detected dev server reachable through the office proxy (SPEC §9.4). */
export const ServiceState = z.object({
  id: Id,
  agentId: Id,
  port: z.number().int().min(1).max(65535),
  /** Proxy path such as `/p/<floor>/port/<n>/`. */
  url: z.string().max(512),
  title: z.string().max(200),
  firstSeenAt: TimestampMs,
  lastSeenAt: TimestampMs,
});
export type ServiceState = z.infer<typeof ServiceState>;

/** A board card currently carried by a human. Keyed by session id. */
export const CarriedCard = z.object({
  sessionId: Id,
  userId: Id,
  cardKind: z.enum(CARD_KINDS),
  repoId: Id,
  number: GhNumber,
  pickedAt: TimestampMs,
});
export type CarriedCard = z.infer<typeof CarriedCard>;

export const RepoSummary = z.object({
  repoId: Id,
  owner: z.string().max(100),
  name: z.string().max(100),
  defaultBranch: z.string().max(200),
  isPrimary: z.boolean(),
});
export type RepoSummary = z.infer<typeof RepoSummary>;

export const FloorState = z.object({
  floorId: Id,
  name: z.string().max(80),
  slug: z.string().max(80),
  paletteId: z.string().max(32),
  layoutTemplateId: z.string().max(64),
  repos: z.array(RepoSummary),
  /** Keyed by agent id. */
  robots: z.record(Id, RobotState),
  /** Keyed by seat id. */
  desks: z.record(Id, DeskState),
  /** Keyed by decor id. */
  decor: z.record(Id, DecorState),
  /** Ordered by `position`. */
  queue: z.array(QueueTask),
  /** Keyed by `<repoId>#<number>`. */
  issues: z.record(z.string(), IssueCard),
  pulls: z.record(z.string(), PullCard),
  /** Keyed by service id. */
  services: z.record(Id, ServiceState),
  /** Bumps whenever the whiteboard snapshot PNG changes. */
  whiteboardVersion: Count,
  /** Keyed by carrier session id. */
  carriedCards: z.record(Id, CarriedCard),
});
export type FloorState = z.infer<typeof FloorState>;

/** Key used for `FloorState.issues` / `FloorState.pulls`. */
export function boardCardKey(repoId: string, number: number): string {
  return `${repoId}#${number}`;
}
