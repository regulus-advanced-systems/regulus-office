/**
 * BuildingRoom state (SPEC §6 channel 1): humans, chat, jukebox, usage
 * summary, PM robot, floor list. Shapes are zod objects; the Colyseus
 * classes in ./schema mirror them field-for-field (see schema/lockstep.test.ts).
 */
import { z } from "zod";
import { Count, Id, TimestampMs, WorldPos } from "./common.ts";
import {
  AVATAR_ANIMATIONS,
  JUKEBOX_SOURCES,
  PM_ACTIVITIES,
  PM_PRIVILEGES,
  PROVIDER_IDS,
  USER_ROLES,
} from "./enums.ts";

/** Robot colour set and accessory chosen by a human for their avatar (SPEC §5 user_profiles.avatar). */
export const AvatarLook = z.object({
  colorSet: z.string().max(32),
  accessory: z.string().max(32),
});
export type AvatarLook = z.infer<typeof AvatarLook>;

/** One connected human. Keyed by Colyseus session id in `BuildingState.humans`. */
export const HumanPresence = z.object({
  sessionId: Id,
  userId: Id,
  displayName: z.string().max(64),
  role: z.enum(USER_ROLES),
  avatar: AvatarLook,
  /** Floor the human is currently on; the lobby has index 0. */
  floorId: Id,
  position: WorldPos,
  animation: z.enum(AVATAR_ANIMATIONS),
  /** Free-text status such as "watching robot Ada" or "at the whiteboard". */
  doing: z.string().max(80),
  /** Seat id when sitting (desk chair, couch), empty when standing. */
  seatId: z.string().max(128),
  sharingScreen: z.boolean(),
  joinedAt: TimestampMs,
});
export type HumanPresence = z.infer<typeof HumanPresence>;

/** Elevator panel entry: one per floor, ordered by `index`. */
export const FloorSummary = z.object({
  floorId: Id,
  name: z.string().max(80),
  slug: z.string().max(80),
  index: Count,
  paletteId: z.string().max(32),
  robotsWorking: Count,
  robotsWaiting: Count,
  robotsTotal: Count,
  humansPresent: Count,
});
export type FloorSummary = z.infer<typeof FloorSummary>;

export const ChatMessage = z.object({
  id: Id,
  userId: Id,
  displayName: z.string().max(64),
  /** Floor the sender was on; empty for building-wide messages. */
  floorId: z.string().max(128),
  text: z.string().max(2000),
  ts: TimestampMs,
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const JukeboxQueueEntry = z.object({
  trackId: Id,
  title: z.string().max(200),
  artist: z.string().max(200),
  source: z.enum(JUKEBOX_SOURCES),
  durationMs: Count,
  addedBy: Id,
});
export type JukeboxQueueEntry = z.infer<typeof JukeboxQueueEntry>;

/** Playhead authority lives on the server (SPEC §5 jukebox_state). */
export const JukeboxState = z.object({
  /** Empty when nothing is loaded. */
  trackId: z.string().max(128),
  /** Server time at which playback position 0 would have started. */
  startedAtServerMs: TimestampMs,
  /** Position at which playback was paused; 0 while playing. */
  pausedAtMs: Count,
  playing: z.boolean(),
  volume: z.number().min(0).max(1),
  queue: z.array(JukeboxQueueEntry),
});
export type JukeboxState = z.infer<typeof JukeboxState>;

export const TopRobotUsage = z.object({
  agentId: Id,
  taskTitle: z.string().max(200),
  provider: z.enum(PROVIDER_IDS),
  tokens: Count,
});
export type TopRobotUsage = z.infer<typeof TopRobotUsage>;

/**
 * Office-wide usage totals shown on the tracker wall. Per-user limits are
 * private (SPEC §9.4) and are never part of shared room state.
 */
export const UsageSummary = z.object({
  todayInputTokens: Count,
  todayOutputTokens: Count,
  todayCostUsdEstimate: z.number().nonnegative(),
  topRobots: z.array(TopRobotUsage),
  observedAt: TimestampMs,
});
export type UsageSummary = z.infer<typeof UsageSummary>;

export const PmState = z.object({
  enabled: z.boolean(),
  privilege: z.enum(PM_PRIVILEGES),
  activity: z.enum(PM_ACTIVITIES),
  floorId: Id,
  position: WorldPos,
  animation: z.enum(AVATAR_ANIMATIONS),
  doing: z.string().max(80),
  /** Robot being visited, empty otherwise. */
  targetAgentId: z.string().max(128),
  /** 0 when no brief has been delivered yet. */
  lastBriefAt: TimestampMs,
});
export type PmState = z.infer<typeof PmState>;

export const BuildingState = z.object({
  /** Keyed by Colyseus session id. */
  humans: z.record(Id, HumanPresence),
  /** Keyed by floor id. */
  floors: z.record(Id, FloorSummary),
  /** Recent messages, oldest first; the server trims to a fixed window. */
  chat: z.array(ChatMessage),
  jukebox: JukeboxState,
  usage: UsageSummary,
  pm: PmState,
});
export type BuildingState = z.infer<typeof BuildingState>;
