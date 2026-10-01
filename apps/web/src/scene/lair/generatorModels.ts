/**
 * Room generator model ids → lair art (#182 → #183). `generateRoom` names a
 * model for every obstacle, seat, desk prop, wall decor item and wall anchor
 * in `room.models`, as `lair/<style>/<thing>` for a decor style's own pieces
 * and `lair/common/<kind>` otherwise. `resolveModelId` turns any of them into
 * a binding: a kit model (piece, fit and sit points), or one of the
 * swappable Looks for the anchors that keep their own behaviour (boards,
 * queue clipboard, gong). `ROOM_MATERIAL_PIECES` does the same for the
 * style's floor and wall material ids. generatorModels.test.ts runs the
 * generator over every style and size and checks every id resolves.
 */
import {
  DECOR_KINDS,
  OBSTACLE_KINDS,
  WALL_ANCHOR_KINDS,
  WALL_DECOR_KINDS,
  type WallAnchorKind,
} from "@regulus/floor-layout";
import { LEATHER_SEAT, STOOL_SEAT } from "./geometry/styleProps.ts";
import type { PieceId } from "./kit.ts";
import { LAIR_CHAIR, LAIR_MODELS, type LairModel } from "./models.ts";

export type LookId = "board" | "clipboard" | "gong";

export type LairBinding = { readonly model: LairModel } | { readonly look: LookId };

const piece = (p: PieceId, extra: Omit<LairModel, "piece"> = {}): LairBinding => ({
  model: { piece: p, ...extra },
});

/** Wall decor and non-Look wall anchors: pieces centred on the anchor, scaled to its size. */
const WALL: Readonly<Record<string, PieceId>> = {
  clock: "wall_clock",
  corkboard: "pinboard",
  poster: "poster",
  shelf: "wall_shelf",
  whiteboard: "whiteboard",
  usage_wall: "usage_panel",
  tv: "usage_panel",
  picture: "picture_frame",
};

const LOOKS: Readonly<Partial<Record<WallAnchorKind, LookId>>> = {
  issue_board: "board",
  pr_board: "board",
  queue_clipboard: "clipboard",
  gong: "gong",
};

/** Desk clutter (`template.decor`), standing on its furniture's top. */
const CLUTTER: Readonly<Record<string, PieceId>> = {
  desk_plant: "desk_plant",
  mugs: "desk_mugs",
  fruit_bowl: "fruit_bowl",
  books: "desk_books",
};

/** The decor styles' own pieces (styles.ts in floor-layout), by model id. */
export const STYLE_MODELS: Readonly<Record<string, LairBinding>> = {
  // Ops room: console desks and teal glow.
  "lair/ops_room/console-desk": piece("pod_desk", { surface: 0.76 }),
  "lair/ops_room/swivel-chair": { model: LAIR_CHAIR },
  "lair/ops_room/filing-cabinet": piece("filing_cabinet"),
  "lair/ops_room/water-cooler": piece("water_cooler", { uniform: true }),
  "lair/ops_room/potted-fern": piece("fern", { uniform: true }),
  "lair/ops_room/desk-fern": piece("fern", { uniform: true, targetHeight: 0.4 }),
  "lair/ops_room/tripod-lamp": piece("work_light", { uniform: true, targetHeight: 1.7 }),
  "lair/ops_room/world-map": piece("poster_world_map"),
  // Lab: benches, lockers and planters.
  "lair/lab/lab-bench": piece("lab_bench", { surface: 0.76 }),
  "lair/lab/lab-stool-chair": piece("stool_chair", { uniform: true, sit: STOOL_SEAT }),
  "lair/lab/reagent-locker": piece("lockers"),
  "lair/lab/specimen-shelf": piece("shelving"),
  "lair/lab/specimen-planter": piece("planter"),
  "lair/lab/seedling-tray": piece("seedling_tray", { uniform: true }),
  "lair/lab/inspection-lamp": piece("arc_lamp", { uniform: true }),
  "lair/lab/periodic-chart": piece("poster_elements"),
  // Workshop: workbenches, tool chests, crates and drums.
  "lair/workshop/workbench-desk": piece("workbench_desk", { surface: 0.76 }),
  "lair/workshop/shop-stool-chair": piece("stool_chair", {
    uniform: true,
    sit: STOOL_SEAT,
    tint: "#E8D2A0",
  }),
  "lair/workshop/tool-chest": piece("tool_chest"),
  "lair/workshop/workbench": piece("workbench", { surface: 0.9 }),
  "lair/workshop/oil-drum-plant": piece("drum_planter", { uniform: true, targetHeight: 1.25 }),
  "lair/workshop/cactus-tin": piece("cactus_tin", { uniform: true }),
  "lair/workshop/work-light": piece("work_light", { uniform: true }),
  "lair/workshop/blueprint": piece("poster_blueprint"),
  "lair/workshop/crate-stack": piece("crate_stack"),
  "lair/workshop/barrel": piece("barrel", { uniform: true }),
  // War room: brass, leather and maps.
  "lair/war_room/briefing-desk": piece("map_table", { surface: 0.78 }),
  "lair/war_room/leather-chair": piece("leather_chair", { uniform: true, sit: LEATHER_SEAT }),
  "lair/war_room/map-chest": piece("map_chest"),
  "lair/war_room/map-cabinet": piece("shelving", { tint: "#C8A27A" }),
  "lair/war_room/potted-palm": piece("palm", { uniform: true }),
  "lair/war_room/brass-pot": piece("fern_brass", { uniform: true, targetHeight: 0.5 }),
  "lair/war_room/brass-lamp": piece("arc_lamp", { uniform: true }),
  "lair/war_room/campaign-map": piece("poster_campaign"),
};

/** `lair/common/<kind>`: every kind the generator can fall back on. */
export function commonBinding(kind: string): LairBinding | undefined {
  if (kind === "chair") return { model: LAIR_CHAIR };
  if ((OBSTACLE_KINDS as readonly string[]).includes(kind))
    return { model: LAIR_MODELS[kind as never] };
  const look = LOOKS[kind as WallAnchorKind];
  if (look) return { look };
  const wall = WALL[kind];
  if (wall) return piece(wall);
  const clutter = CLUTTER[kind];
  if (clutter) return piece(clutter, { uniform: true });
  return undefined;
}

/** Every `lair/common/<kind>` id the generator's fallback can produce. */
export const COMMON_MODEL_IDS: readonly string[] = [
  "chair",
  ...OBSTACLE_KINDS,
  ...WALL_ANCHOR_KINDS,
  ...WALL_DECOR_KINDS,
  ...DECOR_KINDS,
].map((k) => `lair/common/${k}`);

/** The lair art for a generator model id, or undefined for an unknown id. */
export function resolveModelId(id: string): LairBinding | undefined {
  const own = STYLE_MODELS[id];
  if (own) return own;
  const m = /^lair\/common\/([a-z_]+)$/.exec(id);
  return m?.[1] ? commonBinding(m[1]) : undefined;
}

/** Floor and wall material ids (`room.materials`) → pieces. */
export const ROOM_MATERIAL_PIECES = {
  floor: {
    polished_concrete: "floor_concrete",
    lab_tile: "floor_tile",
    steel_plate: "floor_steel",
    war_carpet: "floor_carpet",
  },
  wall: {
    rough_rock: "wall_rock",
    poured_concrete: "wall_concrete",
    riveted_steel: "wall_steel",
  },
} as const satisfies Record<"floor" | "wall", Record<string, PieceId>>;

export function floorPieceFor(material: string): PieceId {
  return (ROOM_MATERIAL_PIECES.floor as Record<string, PieceId>)[material] ?? "floor_concrete";
}

export function wallPieceFor(material: string): "wall_rock" | "wall_concrete" | "wall_steel" {
  return (
    (ROOM_MATERIAL_PIECES.wall as Record<string, "wall_rock" | "wall_concrete" | "wall_steel">)[
      material
    ] ?? "wall_rock"
  );
}
