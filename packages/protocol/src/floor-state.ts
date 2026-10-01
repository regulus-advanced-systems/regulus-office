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
import { DECOR_STYLES } from "./room-settings-api.ts";

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

/**
 * One task of the room's queue (SPEC §5 `tasks`, §9.4; #37). `position` is
 * its place in the list as shown: queued tasks in run order first, then
 * running ones, then recent history.
 */
export const QueueTask = z.object({
  id: Id,
  position: Count,
  kind: z.enum(TASK_KINDS),
  /** Issue / PR number for `issue` and `pr` tasks, 0 for freeform. */
  refNumber: Count,
  repoId: Id,
  title: z.string().max(200),
  prompt: z.string().max(20_000),
  provider: z.enum(PROVIDER_IDS),
  model: z.string().max(100),
  effort: z.string().max(32),
  /** Permission mode the robot will run in; "" = the provider default. */
  permissionMode: z.string().max(32),
  autoWorktree: z.boolean(),
  state: z.enum(TASK_STATES),
  /** Agent running the task, empty until it starts. */
  agentId: z.string().max(128),
  /** The pull request the task's robot opened, 0 until one appears. */
  prNumber: Count,
  /**
   * Why a task failed, or why a queued one is not starting yet (e.g. its
   * owner may no longer spawn here). Short and safe for every viewer.
   */
  reason: z.string().max(200),
  /** The human who queued it and owns its robot. */
  createdBy: Id,
  ownerName: z.string().max(64),
  createdAt: TimestampMs,
  /** 0 until it starts / finishes. */
  startedAt: TimestampMs,
  finishedAt: TimestampMs,
});
export type QueueTask = z.infer<typeof QueueTask>;

/** How many queued tasks may run at once (#37); room managers change it. */
export const QueueSettings = z.object({
  maxRunning: z.number().int().min(1).max(16),
  maxPerOwner: z.number().int().min(1).max(16),
});
export type QueueSettings = z.infer<typeof QueueSettings>;

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

/**
 * A dev server a robot runs in its sandbox, opened through the office's
 * authenticated proxy (SPEC §9.4, #39). Keyed by service id; one per robot and port.
 */
export const ServiceState = z.object({
  id: Id,
  agentId: Id,
  port: z.number().int().min(1).max(65535),
  /** Office proxy path, `/p/<floorId>/a/<agentId>/port/<n>/` (servicesProxyPath). */
  url: z.string().max(512),
  title: z.string().max(200),
  /** Listening process id inside the sandbox; 0 when unknown. */
  pid: z.number().int().min(0),
  /** Bind address, e.g. `0.0.0.0`, `::` or `127.0.0.1`. */
  address: z.string().max(64),
  /**
   * Bound to loopback only inside the robot's sandbox, so the proxy cannot reach it:
   * the server must listen on `0.0.0.0` (Vite `--host`, Next `-H 0.0.0.0`).
   */
  localOnly: z.boolean(),
  /**
   * Whether floor members besides the robot's owner may open it (read-only). True only
   * when the office serves apps on their own origin (`OFFICE_SERVICES_DOMAIN`).
   */
  shared: z.boolean(),
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
  queueSettings: QueueSettings,
  /** Room settings (#182): desks in the generated interior, and its lair decor style. */
  deskCount: Count,
  decorStyle: z.enum(DECOR_STYLES),
});
export type FloorState = z.infer<typeof FloorState>;

/** The office proxy path of a robot's service (SPEC §9.4, #39). */
export function servicesProxyPath(floorId: string, agentId: string, port: number): string {
  return `/p/${encodeURIComponent(floorId)}/a/${encodeURIComponent(agentId)}/port/${port}/`;
}

/** Key used for `FloorState.issues` / `FloorState.pulls`. */
export function boardCardKey(repoId: string, number: number): string {
  return `${repoId}#${number}`;
}
