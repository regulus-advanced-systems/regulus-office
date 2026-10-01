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
export const ROOM_TIERS = ["small", "medium", "large"] as const;
export type RoomTier = (typeof ROOM_TIERS)[number];

export const TEMPLATE_KINDS = ["lobby", ...ROOM_TIERS] as const;
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
  /** The merge gong (#43), rung on PR merges; hung in its own frame. */
  "gong",
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
  "plant_small",
  "planter",
  "armchair",
  "floor_lamp",
  "bench",
] as const;
export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];

export const WALL_HEIGHTS = ["full", "stub"] as const;
export type WallHeight = (typeof WALL_HEIGHTS)[number];

export const WALL_OPENING_KINDS = ["window", "door"] as const;
export type WallOpeningKind = (typeof WALL_OPENING_KINDS)[number];

export const COMPASS_DIRECTIONS = ["north", "south", "east", "west"] as const;

/**
 * Rug colour, resolved against the floor's palette: `warm` takes the second
 * wall colour (cream, orange or crimson), `alt` the second floor colour,
 * `light` a lighter shade of the floor, `wood` a warm oak plank tone.
 */
export const RUG_TONES = ["warm", "alt", "light", "wood"] as const;
export type RugTone = (typeof RUG_TONES)[number];

/** `rug`: a raised rug with a border. `patch`: a flush floor-material zone (wood, lighter tone). */
export const RUG_STYLES = ["rug", "patch"] as const;
export type RugStyle = (typeof RUG_STYLES)[number];

/** Wall decoration that is not interactable (clock, corkboard, poster, shelf). */
export const WALL_DECOR_KINDS = ["clock", "corkboard", "poster", "shelf"] as const;
export type WallDecorKind = (typeof WALL_DECOR_KINDS)[number];

/** Small props standing on furniture; never block navigation. */
export const DECOR_KINDS = ["desk_plant", "mugs", "fruit_bowl", "books"] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];

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

/**
 * A flat rug that anchors a zone (lounge, meeting nook, kitchen) visually.
 * Pure decoration: it never blocks navigation.
 */
export const RugSchema = z.object({
  id: Id,
  rect: RectSchema,
  tone: z.enum(RUG_TONES).default("warm"),
  style: z.enum(RUG_STYLES).default("rug"),
});
export type Rug = z.infer<typeof RugSchema>;

/** Decoration hung on a full wall; checked against anchors, windows and the elevator like anchors. */
export const WallDecorSchema = z.object({
  id: Id,
  kind: z.enum(WALL_DECOR_KINDS),
  wallId: Id,
  /** Distance along the wall from `from` to the centre, metres. */
  t: z.number().finite().nonnegative(),
  /** Height of the centre above the floor, metres. */
  y: PositiveMetres,
  w: PositiveMetres,
  h: PositiveMetres,
});
export type WallDecor = z.infer<typeof WallDecorSchema>;

/** A small prop on top of an obstacle (`on`), e.g. a plant on a desk or mugs on a table. */
export const DecorSchema = z.object({
  id: Id,
  kind: z.enum(DECOR_KINDS),
  on: Id,
  x: Metres,
  z: Metres,
  heading: z.number().finite().default(0),
});
export type Decor = z.infer<typeof DecorSchema>;

// ---- Template ------------------------------------------------------------------

export const RoomTemplateSchema = z.object({
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
  /** Zone rugs (decoration only); optional so older templates still parse. */
  rugs: z.array(RugSchema).default([]),
  /** Non-interactable wall decoration (clock, corkboard, posters). */
  wallDecor: z.array(WallDecorSchema).default([]),
  /** Small props standing on furniture. */
  decor: z.array(DecorSchema).default([]),
  elevator: ElevatorSchema,
  spawn: PoseSchema,
});
export type RoomTemplate = z.infer<typeof RoomTemplateSchema>;
/** What template authors write (defaults not yet applied). */
export type RoomTemplateInput = z.input<typeof RoomTemplateSchema>;

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
