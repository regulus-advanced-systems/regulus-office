/**
 * Floor template and palette types (SPEC §9.1). Templates are plain data
 * validated with zod at load time; see `validate.ts`.
 *
 * Units are metres on the ground plane, origin at the north-west corner of the
 * room (see `geometry.ts` for the axis and heading conventions).
 */
import { z } from "zod";

// ---- Enums -----------------------------------------------------------------

/** Desk-count tiers for project floors (SPEC §9.1). The lobby is its own kind. */
export const FLOOR_TIERS = ["small", "medium", "large"] as const;
export type FloorTier = (typeof FLOOR_TIERS)[number];

export const TEMPLATE_KINDS = ["lobby", ...FLOOR_TIERS] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** Desk seats are agent workstations; the rest are for humans / the PM robot. */
export const SEAT_KINDS = ["desk", "reception", "chair", "couch"] as const;
export type SeatKind = (typeof SEAT_KINDS)[number];

export const WALL_ANCHOR_KINDS = [
  "issue_board",
  "pr_board",
  "queue_clipboard",
  "whiteboard",
  "usage_wall",
  "tv",
  "picture",
] as const;
export type WallAnchorKind = (typeof WALL_ANCHOR_KINDS)[number];

export const OBSTACLE_KINDS = [
  "desk",
  "shared_table",
  "ceo_desk",
  "meeting_table",
  "reception_desk",
  "cabinet",
  "bookshelf",
  "counter",
  "fridge",
  "coffee_machine",
  "water_cooler",
  "bistro_table",
  "coffee_table",
  "couch",
  "jukebox",
  "plant",
] as const;
export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];

export const WALL_HEIGHTS = ["full", "stub"] as const;
export type WallHeight = (typeof WALL_HEIGHTS)[number];

export const WALL_OPENING_KINDS = ["window", "door"] as const;
export type WallOpeningKind = (typeof WALL_OPENING_KINDS)[number];

export const COMPASS_DIRECTIONS = ["north", "south", "east", "west"] as const;

// ---- Primitives --------------------------------------------------------------

const Metres = z.number().finite();
const PositiveMetres = z.number().finite().positive();
const Id = z.string().min(1).max(64);

export const Vec2Schema = z.object({ x: Metres, z: Metres });
export const RectSchema = z.object({ x: Metres, z: Metres, w: PositiveMetres, d: PositiveMetres });
export const PoseSchema = Vec2Schema.extend({ heading: z.number().finite() });

// ---- Walls -------------------------------------------------------------------

export const WallOpeningSchema = z.object({
  kind: z.enum(WALL_OPENING_KINDS),
  /** Distance along the wall from `from` to the opening's start, metres. */
  t: z.number().finite().nonnegative(),
  w: PositiveMetres,
});
export type WallOpening = z.infer<typeof WallOpeningSchema>;

/**
 * An axis-aligned wall segment. `facing` is the side that hosts anchors (the
 * room interior for perimeter walls). A two-sided partition is authored as two
 * walls sharing one segment with opposite `facing`.
 */
export const WallSchema = z.object({
  id: Id,
  from: Vec2Schema,
  to: Vec2Schema,
  height: z.enum(WALL_HEIGHTS),
  facing: z.enum(COMPASS_DIRECTIONS),
  openings: z.array(WallOpeningSchema).default([]),
});
export type Wall = z.infer<typeof WallSchema>;

/** Something hung on a wall: boards, clipboard, whiteboard, TV, pictures. */
export const WallAnchorSchema = z.object({
  id: Id,
  kind: z.enum(WALL_ANCHOR_KINDS),
  wallId: Id,
  /** Distance along the wall from `from` to the anchor's centre, metres. */
  t: z.number().finite().nonnegative(),
  /** Height of the anchor's centre above the floor, metres. */
  y: PositiveMetres,
  w: PositiveMetres,
  h: PositiveMetres,
  /** How far in front of the wall an avatar stands to interact (default 0.75 m). */
  approach: PositiveMetres.default(0.75),
});
export type WallAnchor = z.infer<typeof WallAnchorSchema>;

// ---- Furniture ---------------------------------------------------------------

export const SeatSchema = z.object({
  id: Id,
  kind: z.enum(SEAT_KINDS),
  /** Where the avatar stands, then sits; must be a walkable cell. */
  pose: PoseSchema,
  /** Obstacle the seat belongs to (desk, table, couch), if any. */
  furnitureId: Id.optional(),
});
export type Seat = z.infer<typeof SeatSchema>;

/** Nav-blocking furniture footprint. `standAt` makes it interactable. */
export const ObstacleSchema = z.object({
  id: Id,
  kind: z.enum(OBSTACLE_KINDS),
  rect: RectSchema,
  standAt: PoseSchema.optional(),
});
export type Obstacle = z.infer<typeof ObstacleSchema>;

export const ElevatorSchema = z.object({
  /** Footprint of the door recess; it blocks navigation like an obstacle. */
  rect: RectSchema,
  /** Full-height wall the doors are set into. */
  wallId: Id,
  /** Where an avatar stands in front of the doors (also the spawn point). */
  door: PoseSchema,
});
export type Elevator = z.infer<typeof ElevatorSchema>;

// ---- Template ------------------------------------------------------------------

export const FloorTemplateSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  kind: z.enum(TEMPLATE_KINDS),
  /** Interior size in metres: `width` along x, `depth` along z. */
  size: z.object({ width: PositiveMetres, depth: PositiveMetres }),
  wallHeight: PositiveMetres,
  stubHeight: PositiveMetres,
  walls: z.array(WallSchema).min(4),
  /** Wall whose exterior face carries the painted floor name (a stub wall). */
  nameWallId: Id,
  seats: z.array(SeatSchema),
  wallAnchors: z.array(WallAnchorSchema),
  obstacles: z.array(ObstacleSchema),
  elevator: ElevatorSchema,
  spawn: PoseSchema,
});
export type FloorTemplate = z.infer<typeof FloorTemplateSchema>;
/** What template authors write (defaults not yet applied). */
export type FloorTemplateInput = z.input<typeof FloorTemplateSchema>;

// ---- Palette -------------------------------------------------------------------

const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const PaletteSchema = z.object({
  id: z.string().min(1).max(32),
  name: z.string().min(1).max(64),
  floor: Hex,
  /** Second floor colour for zoned / patterned floors. */
  floorAlt: Hex.optional(),
  wall: Hex,
  /** Second wall colour when the two back walls differ. */
  wallAlt: Hex.optional(),
  accent: Hex,
  /** Exterior face of the stub walls (carries the floor name). */
  exterior: Hex,
  /** Dark cap on top of the stub walls. */
  cap: Hex,
});
export type Palette = z.infer<typeof PaletteSchema>;

/** Something an avatar can walk up to and press `E` on (SPEC §9.2). */
export interface Interactable {
  readonly id: string;
  readonly kind: "elevator" | WallAnchorKind | ObstacleKind;
  readonly standAt: { readonly x: number; readonly z: number; readonly heading: number };
}
