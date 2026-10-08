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
    operationId: t.string().default(""),
    levelId: t.string().default("lobby"),
    position: WorldPosSchema,
    animation: t.string().default("idle"),
    doing: t.string().default(""),
    seatId: t.string().default(""),
    sharingScreen: t.boolean().default(false),
    joinedAt: t.number().default(0),
  },
  "HumanPresence",
);

export const OperationSummarySchema = schema(
  {
    operationId: t.string().default(""),
    levelId: t.string().default("lobby"),
    name: t.string().default(""),
    slug: t.string().default(""),
    index: t.uint16().default(0),
    paletteId: t.string().default(""),
    henchmenWorking: t.uint16().default(0),
    henchmenWaiting: t.uint16().default(0),
    henchmenTotal: t.uint16().default(0),
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
  "OperationSummary",
);

export const ClosedRoomSchema = schema(
  {
    operationId: t.string().default(""),
    levelId: t.string().default("lobby"),
    gridX: t.int16().default(-1),
    gridY: t.int16().default(-1),
    width: t.uint16().default(0),
    depth: t.uint16().default(0),
    doorSide: t.string().default("south"),
    doorX: t.int16().default(-1),
    doorY: t.int16().default(-1),
    closed: t.boolean().default(true),
  },
  "ClosedRoom",
);

export const ChatMessageSchema = schema(
  {
    id: t.string().default(""),
    userId: t.string().default(""),
    displayName: t.string().default(""),
    operationId: t.string().default(""),
    text: t.string().default(""),
    ts: t.number().default(0),
  },
  "ChatMessage",
);

export const JukeboxQueueEntrySchema = schema(
  {
    entryId: t.string().default(""),
    trackId: t.string().default(""),
    title: t.string().default(""),
    artist: t.string().default(""),
    source: t.string().default("file"),
    videoId: t.string().default(""),
    durationMs: t.uint32().default(0),
    addedBy: t.string().default(""),
    addedByName: t.string().default(""),
  },
  "JukeboxQueueEntry",
);

export const JukeboxStateSchema = schema(
  {
    current: JukeboxQueueEntrySchema,
    startedAtServerMs: t.number().default(0),
    pausedAtMs: t.uint32().default(0),
    playing: t.boolean().default(false),
    volume: t.float64().default(0.6),
    queue: t.array(JukeboxQueueEntrySchema),
  },
  "JukeboxState",
);

export const TopHenchmanUsageSchema = schema(
  {
    agentId: t.string().default(""),
    name: t.string().default(""),
    ownerName: t.string().default(""),
    provider: t.string().default("custom"),
    tokens: t.number().default(0),
  },
  "TopHenchmanUsage",
);

export const UsageSummarySchema = schema(
  {
    todayInputTokens: t.number().default(0),
    todayOutputTokens: t.number().default(0),
    todayCacheTokens: t.number().default(0),
    todayCostUsdEstimate: t.float64().default(0),
    officeKeysCostUsdEstimate: t.float64().default(0),
    activeHumans: t.number().default(0),
    // Per viewer (#270): a row reaches only clients whose view holds it.
    topHenchmen: t.array(TopHenchmanUsageSchema).view(),
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
    operationId: t.string().default(""),
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

export const LevelStateSchema = schema(
  {
    levelId: t.string().default(""),
    kind: t.string().default("account"),
    login: t.string().default(""),
    name: t.string().default(""),
    order: t.uint16().default(0),
    compound: CompoundStateSchema,
  },
  "LevelState",
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

export const OfficeAgentBodySchema = schema(
  {
    agentId: t.string().default(""),
    name: t.string().default(""),
    ownerUserId: t.string().default(""),
    ownerName: t.string().default(""),
    appearance: t.string().default("standard"),
    status: t.string().default("stopped"),
    levelId: t.string().default("lobby"),
    operationId: t.string().default(""),
    mode: t.string().default("wander"),
    target: WorldPosSchema,
    hop: t.uint32().default(0),
    doing: t.string().default(""),
    dismissed: t.boolean().default(false),
    post: t.string().default("none"),
  },
  "OfficeAgentBody",
);

export const BuildingStateSchema = schema(
  {
    // Per viewer (D26, D27; #270): each entry of these maps reaches only the
    // clients whose view holds it (the BuildingRoom decides, rooms/building/viewers.ts).
    humans: t.map(HumanPresenceSchema).view(),
    operations: t.map(OperationSummarySchema).view(),
    closedRooms: t.map(ClosedRoomSchema).view(),
    // Per viewer too: a line written inside a room is for the people who may enter it.
    chat: t.array(ChatMessageSchema).view(),
    jukebox: JukeboxStateSchema,
    usage: UsageSummarySchema,
    pm: PmStateSchema,
    compound: CompoundStateSchema,
    levels: t.map(LevelStateSchema).view(),
    blastDoor: BlastDoorStateSchema,
    lobbyWhiteboardVersion: t.uint32().default(0),
    // Per viewer (#252, #270): a body reaches only clients who may see the place it is in.
    officeAgents: t.map(OfficeAgentBodySchema).view(),
  },
  "BuildingState",
);
