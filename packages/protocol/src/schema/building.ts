/**
 * Colyseus schema classes for the BuildingRoom. Field names and order must
 * match the zod shapes in ../building-state.ts (enforced by lockstep.test.ts).
 */
import { schema, t } from "@colyseus/schema";
import { WorldPosSchema } from "./common.ts";

export const GeniusLookSchema = schema(
  {
    archetype: t.string().default("mastermind"),
    outfit: t.string().default("charcoal"),
    trim: t.string().default("brass"),
    skin: t.string().default("light"),
    hair: t.string().default("black"),
    accessory: t.string().default("none"),
  },
  "GeniusLook",
);

export const HumanPresenceSchema = schema(
  {
    sessionId: t.string().default(""),
    userId: t.string().default(""),
    displayName: t.string().default(""),
    role: t.string().default("viewer"),
    avatar: GeniusLookSchema,
    floorId: t.string().default(""),
    position: WorldPosSchema,
    animation: t.string().default("idle"),
    doing: t.string().default(""),
    seatId: t.string().default(""),
    sharingScreen: t.boolean().default(false),
    joinedAt: t.number().default(0),
  },
  "HumanPresence",
);

export const FloorSummarySchema = schema(
  {
    floorId: t.string().default(""),
    name: t.string().default(""),
    slug: t.string().default(""),
    index: t.uint16().default(0),
    paletteId: t.string().default(""),
    robotsWorking: t.uint16().default(0),
    robotsWaiting: t.uint16().default(0),
    robotsTotal: t.uint16().default(0),
    humansPresent: t.uint16().default(0),
    gridX: t.int16().default(-1),
    gridY: t.int16().default(-1),
    width: t.uint16().default(0),
    depth: t.uint16().default(0),
    doorSide: t.string().default("south"),
    doorX: t.int16().default(-1),
    doorY: t.int16().default(-1),
    buildState: t.string().default("ready"),
    buildEndsAt: t.number().default(0),
    deskCount: t.uint16().default(0),
    decorStyle: t.string().default("ops_room"),
  },
  "FloorSummary",
);

export const ChatMessageSchema = schema(
  {
    id: t.string().default(""),
    userId: t.string().default(""),
    displayName: t.string().default(""),
    floorId: t.string().default(""),
    text: t.string().default(""),
    ts: t.number().default(0),
  },
  "ChatMessage",
);

export const JukeboxQueueEntrySchema = schema(
  {
    trackId: t.string().default(""),
    title: t.string().default(""),
    artist: t.string().default(""),
    source: t.string().default("file"),
    durationMs: t.uint32().default(0),
    addedBy: t.string().default(""),
  },
  "JukeboxQueueEntry",
);

export const JukeboxStateSchema = schema(
  {
    trackId: t.string().default(""),
    startedAtServerMs: t.number().default(0),
    pausedAtMs: t.uint32().default(0),
    playing: t.boolean().default(false),
    volume: t.float64().default(0.5),
    queue: t.array(JukeboxQueueEntrySchema),
  },
  "JukeboxState",
);

export const TopRobotUsageSchema = schema(
  {
    agentId: t.string().default(""),
    name: t.string().default(""),
    ownerName: t.string().default(""),
    provider: t.string().default("custom"),
    tokens: t.number().default(0),
  },
  "TopRobotUsage",
);

export const UsageSummarySchema = schema(
  {
    todayInputTokens: t.number().default(0),
    todayOutputTokens: t.number().default(0),
    todayCacheTokens: t.number().default(0),
    todayCostUsdEstimate: t.float64().default(0),
    officeKeysCostUsdEstimate: t.float64().default(0),
    activeHumans: t.number().default(0),
    topRobots: t.array(TopRobotUsageSchema),
    dayStart: t.number().default(0),
    observedAt: t.number().default(0),
  },
  "UsageSummary",
);

export const PmStateSchema = schema(
  {
    enabled: t.boolean().default(false),
    privilege: t.string().default("coordinator"),
    activity: t.string().default("idle"),
    floorId: t.string().default(""),
    position: WorldPosSchema,
    animation: t.string().default("idle"),
    doing: t.string().default(""),
    targetAgentId: t.string().default(""),
    lastBriefAt: t.number().default(0),
  },
  "PmState",
);

export const TileRectSchema = schema(
  {
    x: t.uint16().default(0),
    y: t.uint16().default(0),
    w: t.uint16().default(0),
    d: t.uint16().default(0),
  },
  "TileRect",
);

export const SpecialRoomStateSchema = schema(
  {
    kind: t.string().default("lobby"),
    gridX: t.uint16().default(0),
    gridY: t.uint16().default(0),
    width: t.uint16().default(0),
    depth: t.uint16().default(0),
    doorSide: t.string().default("north"),
    doorX: t.uint16().default(0),
    doorY: t.uint16().default(0),
  },
  "SpecialRoomState",
);

export const CompoundStateSchema = schema(
  {
    width: t.uint16().default(0),
    depth: t.uint16().default(0),
    tileMetres: t.float64().default(2),
    outsideDepth: t.uint16().default(0),
    version: t.number().default(0),
    specialRooms: t.array(SpecialRoomStateSchema),
    corridors: t.array(TileRectSchema),
    blastDoorX: t.uint16().default(0),
    blastDoorY: t.uint16().default(0),
    blastDoorWidth: t.uint16().default(0),
  },
  "CompoundState",
);

export const BlastDoorStateSchema = schema(
  {
    phase: t.string().default("closed"),
    openedAt: t.number().default(0),
    closesAt: t.number().default(0),
    openedBy: t.string().default(""),
    presses: t.uint32().default(0),
  },
  "BlastDoorState",
);

export const BuildingStateSchema = schema(
  {
    humans: t.map(HumanPresenceSchema),
    floors: t.map(FloorSummarySchema),
    chat: t.array(ChatMessageSchema),
    jukebox: JukeboxStateSchema,
    usage: UsageSummarySchema,
    pm: PmStateSchema,
    compound: CompoundStateSchema,
    blastDoor: BlastDoorStateSchema,
  },
  "BuildingState",
);
