/**
 * The compound (SPEC §9.1, D21): the office's grid of rooms, the lobby at the
 * south edge, auto-routed corridors, special rooms and the beach strip.
 *
 * Grid conventions shared by the server, @regulus/room-layout and the web:
 * - One tile is {@link COMPOUND_TILE_METRES} metres. Tile `(x, y)` covers
 *   world metres `[2x, 2x+2) × [2y, 2y+2)`; `x` grows east, `y` grows south
 *   (world `z`), so the compound's origin is its north-west corner.
 * - The compound spans tiles `[0, width) × [0, depth)`; the outside strip
 *   (beach) is the {@link OUTSIDE_STRIP_TILES} rows south of it.
 * - A door is a wall segment of {@link DOOR_WIDTH_TILES} tiles, fully open.
 *   `(doorX, doorY)` is the grid point (tile corner) where it starts; it runs
 *   east along a north/south wall and south along an east/west wall.
 *
 * Code calls a project room an operation (#226; SPEC §2 still says floor).
 */
import { z } from "zod";
import { Count, Id, TimestampMs } from "./common.ts";
import { LevelInfo } from "./levels.ts";
import { CreateOperationRequest, OperationHenchmanInfo, OperationInfo } from "./operations-api.ts";

export const COMPOUND_TILE_METRES = 2;
export const ROOM_MIN_TILES = 4;
export const ROOM_MAX_TILES = 12;
/** Smallest clear space between two rooms, so a corridor fits between them. */
export const ROOM_MIN_GAP_TILES = 2;
export const CORRIDOR_WIDTH_TILES = 2;
export const DOOR_WIDTH_TILES = 2;
/** Rows of beach south of the compound, outside the lobby's blast door. */
export const OUTSIDE_STRIP_TILES = 6;
export const DEFAULT_COMPOUND_SIZE_TILES = 64;
export const MIN_COMPOUND_SIZE_TILES = 48;
export const MAX_COMPOUND_SIZE_TILES = 256;
/** Default length of a new room's build phase (OFFICE_ROOM_BUILD_SECONDS). */
export const DEFAULT_ROOM_BUILD_SECONDS = 20;

export const DOOR_SIDES = ["north", "south", "east", "west"] as const;
export type DoorSide = (typeof DOOR_SIDES)[number];

export const ROOM_BUILD_STATES = ["building", "ready"] as const;
export type RoomBuildState = (typeof ROOM_BUILD_STATES)[number];

/** Fixed rooms that are not buildable (SPEC §9.1). */
export const SPECIAL_ROOM_KINDS = ["lobby", "conference", "break_room"] as const;
export type SpecialRoomKind = (typeof SPECIAL_ROOM_KINDS)[number];

/** Why a placement was refused; in the order the checks run. */
export const PLACEMENT_ERRORS = [
  "bad_size",
  "out_of_bounds",
  "overlap",
  "too_close",
  "door_blocked",
  "unreachable",
  /** The room would cut another room off from the lobby. */
  "blocks_room",
] as const;
export type PlacementError = (typeof PLACEMENT_ERRORS)[number];

const Tile = z
  .number()
  .int()
  .nonnegative()
  .max(MAX_COMPOUND_SIZE_TILES + OUTSIDE_STRIP_TILES);
const RoomSpan = z.number().int().min(ROOM_MIN_TILES).max(ROOM_MAX_TILES);

/** Where a project room sits: its footprint in tiles and its door side. */
export const RoomPlacement = z.object({
  gridX: Tile,
  gridY: Tile,
  width: RoomSpan,
  depth: RoomSpan,
  doorSide: z.enum(DOOR_SIDES),
});
export type RoomPlacement = z.infer<typeof RoomPlacement>;

/** Axis-aligned tile rectangle: `[x, x+w) × [y, y+d)`. */
export const TileRect = z.object({ x: Tile, y: Tile, w: Count, d: Count });
export type TileRect = z.infer<typeof TileRect>;

/** One fixed room (lobby, conference/war room, break room) with its door. */
export const SpecialRoomState = z.object({
  kind: z.enum(SPECIAL_ROOM_KINDS),
  gridX: Tile,
  gridY: Tile,
  width: Count,
  depth: Count,
  doorSide: z.enum(DOOR_SIDES),
  doorX: Tile,
  doorY: Tile,
});
export type SpecialRoomState = z.infer<typeof SpecialRoomState>;

/**
 * The compound layout in the BuildingRoom. Project rooms are the entries of
 * `BuildingState.operations` (placement, door, build state, counters); this holds
 * everything else. Corridors are derived from the rooms and republished
 * whenever a room is placed, moved or removed.
 */
export const CompoundState = z.object({
  /** Compound size in tiles; 0 until the layout is first published. */
  width: Count,
  depth: Count,
  tileMetres: z.number().positive(),
  /** Beach rows south of the compound (outside the blast door). */
  outsideDepth: Count,
  /** Changes whenever the layout does (a hash); clients rebuild their nav grid on change. */
  version: Count,
  specialRooms: z.array(SpecialRoomState),
  /** Corridor tiles as disjoint rectangles; their union is the corridor network. */
  corridors: z.array(TileRect),
  /** The blast door: a segment of the lobby's south wall, starting at this grid point. */
  blastDoorX: Tile,
  blastDoorY: Tile,
  blastDoorWidth: Count,
});
export type CompoundState = z.infer<typeof CompoundState>;

/**
 * One level in the BuildingRoom (D26, #268): who it belongs to and its own
 * layout (corridors and fixed rooms). Its project rooms are the
 * `BuildingState.operations` entries with this `levelId`.
 */
export const LevelState = LevelInfo.extend({ compound: CompoundState });
export type LevelState = z.infer<typeof LevelState>;

/** The layout before the server publishes one (the schema defaults). */
export const EMPTY_COMPOUND: CompoundState = {
  width: 0,
  depth: 0,
  tileMetres: COMPOUND_TILE_METRES,
  outsideDepth: 0,
  version: 0,
  specialRooms: [],
  corridors: [],
  blastDoorX: 0,
  blastDoorY: 0,
  blastDoorWidth: 0,
};

// ---- REST ---------------------------------------------------------------------------

/**
 * Compound REST (SPEC §9.1). Reads need a session; writes are office
 * owner/admin only, same-origin and audited.
 *
 *   GET    /api/compound                       layout + room summaries
 *   POST   /api/compound/check                 would this placement be valid? (build-mode ghost)
 *   POST   /api/compound/rooms                 place a new room (creates the operation and its repos)
 *   PATCH  /api/compound/rooms/:operationId        move/resize a room (refused while henchmen run in it)
 *   DELETE /api/compound/rooms/:operationId        remove: the operation delete (#150), typed name confirms
 */
export const COMPOUND_API_PATH = "/api/compound";
export const COMPOUND_CHECK_API_PATH = `${COMPOUND_API_PATH}/check`;
export const COMPOUND_ROOMS_API_PATH = `${COMPOUND_API_PATH}/rooms`;

/** A project room as listed by `GET /api/compound` (same fields as the building room's summary). */
export const CompoundRoomInfo = RoomPlacement.extend({
  operationId: Id,
  /** The level whose grid the room is placed on (#268). */
  levelId: Id,
  name: z.string().max(80),
  doorX: Tile,
  doorY: Tile,
  buildState: z.enum(ROOM_BUILD_STATES),
  /** When the build phase ends (server ms); 0 when ready. */
  buildEndsAt: TimestampMs,
});
export type CompoundRoomInfo = z.infer<typeof CompoundRoomInfo>;

export const CompoundLayoutResponse = z.object({
  /** The lobby level's layout. */
  compound: CompoundState,
  /** Every level with its own layout, lobby first (#268). */
  levels: z.array(LevelState),
  /** The project rooms of every level; `levelId` says which grid each is on. */
  rooms: z.array(CompoundRoomInfo),
});
export type CompoundLayoutResponse = z.infer<typeof CompoundLayoutResponse>;

/**
 * Body of `POST /api/compound/check`. Each level has its own grid (#268), so
 * the check needs the level: `operationId` (checking a move) means that
 * room's level and ignores the room itself; otherwise `levelId` (a new room
 * on that level). With neither, the lobby level's grid is checked.
 */
export const CheckPlacementRequest = z.object({
  placement: RoomPlacement,
  operationId: Id.optional(),
  levelId: Id.optional(),
});
export type CheckPlacementRequest = z.infer<typeof CheckPlacementRequest>;

export const PlacementCheckResponse = z.object({
  ok: z.boolean(),
  reason: z.enum(PLACEMENT_ERRORS).optional(),
  /** Room ids (operation ids or special room kinds) the placement collides with or cuts off. */
  conflicts: z.array(z.string().max(128)),
});
export type PlacementCheckResponse = z.infer<typeof PlacementCheckResponse>;

/** Body of `POST /api/compound/rooms`: an operation create request plus where to build it. */
export const PlaceRoomRequest = CreateOperationRequest.extend({ placement: RoomPlacement });
export type PlaceRoomRequest = z.input<typeof PlaceRoomRequest>;

/** 201 body of `POST /api/compound/rooms`. */
export const PlaceRoomResponse = z.object({ operation: OperationInfo, room: CompoundRoomInfo });
export type PlaceRoomResponse = z.infer<typeof PlaceRoomResponse>;

/** Body of `PATCH /api/compound/rooms/:operationId`. */
export const MoveRoomRequest = z.object({ placement: RoomPlacement });
export type MoveRoomRequest = z.infer<typeof MoveRoomRequest>;

/** 409 body of a refused placement or move. */
export const PlacementRefusedResponse = z.object({
  error: z.literal("placement_invalid"),
  reason: z.enum(PLACEMENT_ERRORS),
  conflicts: z.array(z.string().max(128)),
});
export type PlacementRefusedResponse = z.infer<typeof PlacementRefusedResponse>;

/** 409 body of a move refused while henchmen run in the room. */
export const RoomHasRunningHenchmenResponse = z.object({
  error: z.literal("room_has_running_henchmen"),
  henchmen: z.array(OperationHenchmanInfo),
});
export type RoomHasRunningHenchmenResponse = z.infer<typeof RoomHasRunningHenchmenResponse>;
