/**
 * BuildingRoom state (SPEC §6 channel 1): humans, chat, jukebox, usage
 * summary, PM robot, floor list. Shapes are zod objects; the Colyseus
 * classes in ./schema mirror them field-for-field (see schema/lockstep.test.ts).
 */
import { z } from "zod";
import { Count, Id, TimestampMs, WorldPos } from "./common.ts";
import { CompoundState, DOOR_SIDES, ROOM_BUILD_STATES } from "./compound.ts";
import {
  AVATAR_ANIMATIONS,
  JUKEBOX_SOURCES,
  PM_ACTIVITIES,
  PM_PRIVILEGES,
  PROVIDER_IDS,
  USER_ROLES,
} from "./enums.ts";
import {
  checkGeniusLook,
  GENIUS_ARCHETYPES,
  GENIUS_HAIRS,
  GENIUS_OUTFITS,
  GENIUS_SKINS,
  GENIUS_TRIMS,
} from "./genius.ts";

/**
 * Robot colour set and accessory, derived on the client (scene/robots); not
 * part of room state. Humans are geniuses since #185 (`GeniusLook`).
 */
export interface AvatarLook {
  colorSet: string;
  accessory: string;
}

const ids = <T extends object>(record: T) => Object.keys(record) as [keyof T & string];

/**
 * A human's genius (SPEC §5 `user_profiles.avatar`, §9.3): archetype, colour
 * ids and an accessory of that archetype (genius.ts holds the catalogue and
 * the plain validator the server uses for request bodies).
 */
export const GeniusLook = z
  .object({
    archetype: z.enum(GENIUS_ARCHETYPES),
    outfit: z.enum(ids(GENIUS_OUTFITS)),
    trim: z.enum(ids(GENIUS_TRIMS)),
    skin: z.enum(ids(GENIUS_SKINS)),
    hair: z.enum(ids(GENIUS_HAIRS)),
    accessory: z.string().max(32),
  })
  .refine((look) => checkGeniusLook(look).ok, {
    message: "accessory does not belong to the archetype",
    path: ["accessory"],
  });
export type GeniusLook = z.infer<typeof GeniusLook>;

/** One connected human. Keyed by Colyseus session id in `BuildingState.humans`. */
export const HumanPresence = z.object({
  sessionId: Id,
  userId: Id,
  displayName: z.string().max(64),
  role: z.enum(USER_ROLES),
  avatar: GeniusLook,
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

/** Tile coordinate of a room; -1 only for a floor not yet placed (briefly, at boot). */
const RoomTile = z.number().int().min(-1);

/**
 * One room of the compound (project room, or the lobby under its fixed id):
 * the elevator/quick-travel entry, counters for its closed door, and its
 * placement (compound.ts has the grid conventions).
 */
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
  gridX: RoomTile,
  gridY: RoomTile,
  width: Count,
  depth: Count,
  doorSide: z.enum(DOOR_SIDES),
  doorX: RoomTile,
  doorY: RoomTile,
  buildState: z.enum(ROOM_BUILD_STATES),
  /** When the build phase ends (server ms); 0 when ready. */
  buildEndsAt: TimestampMs,
});
export type FloorSummary = z.infer<typeof FloorSummary>;

/** The placement and build fields of a `FloorSummary`. */
export type RoomSummaryFields = Pick<
  FloorSummary,
  | "gridX"
  | "gridY"
  | "width"
  | "depth"
  | "doorSide"
  | "doorX"
  | "doorY"
  | "buildState"
  | "buildEndsAt"
>;

/** Placement fields of a room not on the compound map yet (the schema defaults). */
export const UNPLACED_ROOM: RoomSummaryFields = {
  gridX: -1,
  gridY: -1,
  width: 0,
  depth: 0,
  doorSide: "south",
  doorX: -1,
  doorY: -1,
  buildState: "ready",
  buildEndsAt: 0,
};

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

/** A robot on the usage wall's leaderboard: its display name and owner only (#40). */
export const TopRobotUsage = z.object({
  agentId: Id,
  name: z.string().max(120),
  ownerName: z.string().max(64),
  provider: z.enum(PROVIDER_IDS),
  /** All tokens today: input, output, cache reads and cache writes. */
  tokens: Count,
});
export type TopRobotUsage = z.infer<typeof TopRobotUsage>;

/**
 * Office-wide usage totals shown on the tracker wall, for the office's day
 * (from `dayStart`). Per-user limits and spend are private (SPEC §9.4) and
 * are never part of shared room state; each human reads their own over REST
 * (usage-api.ts).
 */
export const UsageSummary = z.object({
  todayInputTokens: Count,
  todayOutputTokens: Count,
  /** Cache reads plus cache writes. */
  todayCacheTokens: Count,
  todayCostUsdEstimate: z.number().nonnegative(),
  /** Of today's estimate, usage through office-wide keys (attributed to `office`, D2). */
  officeKeysCostUsdEstimate: z.number().nonnegative(),
  /** Humans with any usage today. */
  activeHumans: Count,
  topRobots: z.array(TopRobotUsage),
  /** Start of the office's day the totals count from; 0 until first published. */
  dayStart: TimestampMs,
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
  /** Compound grid, special rooms and corridors (SPEC §9.1); rooms are in `floors`. */
  compound: CompoundState,
});
export type BuildingState = z.infer<typeof BuildingState>;
