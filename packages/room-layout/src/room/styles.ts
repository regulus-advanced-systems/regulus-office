/**
 * Lair decor styles (#182, SPEC §12): what a room looks like, never what it
 * does. A style picks the palette and materials, the lighting, which model
 * draws each piece of furniture and which props fill the decor sites. Every
 * prop a style picks for a site has the same footprint in all styles, so
 * seats, desks, boards, the door and the lanes are identical across styles.
 *
 * Model ids are plain strings (`lair/<style>/<thing>`) that the lair art kit
 * (#183) maps to assets; the scene falls back on the obstacle kind when it
 * has no model for an id.
 */
import { DECOR_STYLES, type DecorStyle } from "@regulus/protocol";
import { type Palette, PaletteSchema, type RugTone } from "../types.ts";

/** Kinds a style's corner and wall decor sites may hold (all existing obstacle kinds). */
export type SiteKind =
  | "plant"
  | "plant_small"
  | "cabinet"
  | "bookshelf"
  | "counter"
  | "water_cooler"
  | "bench";

export interface DecorStyleSpec {
  readonly id: DecorStyle;
  readonly name: string;
  readonly blurb: string;
  readonly palette: Palette;
  /** Floor and wall material ids for the art kit. */
  readonly floorMaterial: string;
  readonly wallMaterial: string;
  readonly rugTone: RugTone;
  readonly lighting: {
    /** Hemisphere sky / ground colours and intensity. */
    readonly sky: string;
    readonly ground: string;
    readonly ambient: number;
    /** Warm pool over each desk. */
    readonly pendant: string;
    readonly pendantIntensity: number;
    /** Floor lamps. */
    readonly lamp: string;
    /** The style's accent light (console glow, beacon, work light) by the board wall. */
    readonly accent: string;
  };
  /** Big corner site (0.8 m square). */
  readonly corner: SiteKind;
  /** Long wall site (1.2 × 0.4 m). */
  readonly wallLong: SiteKind;
  /** Short wall site (0.4 m square). */
  readonly wallShort: SiteKind;
  /** Desk clutter, cycled per desk (two per desk). */
  readonly clutter: readonly ("desk_plant" | "mugs" | "fruit_bowl" | "books")[];
  /** Wall decor in the order it is hung as the room fills. */
  readonly wallDecor: readonly ("clock" | "corkboard" | "poster" | "shelf")[];
  /** Model id per piece; anything missing falls back to `lair/common/<kind>`. */
  readonly models: Readonly<Record<string, string>>;
}

const palette = (p: Omit<Palette, "id" | "name">, id: string, name: string): Palette =>
  PaletteSchema.parse({ id, name, ...p });

const models = (style: string, pairs: Record<string, string>) =>
  Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, `lair/${style}/${v}`]));

export const DECOR_STYLE_SPECS: Readonly<Record<DecorStyle, DecorStyleSpec>> = {
  ops_room: {
    id: "ops_room",
    name: "Ops room",
    blurb: "Console desks, filing cabinets and teal screen glow on polished concrete.",
    palette: palette(
      {
        floor: "#5E6266",
        floorAlt: "#4A4F55",
        wall: "#6B6259",
        wallAlt: "#7A7066",
        accent: "#2EC4B6",
        exterior: "#3C3A38",
        cap: "#2B2B2E",
      },
      "lair-ops",
      "Ops room: concrete and rock, console teal",
    ),
    floorMaterial: "polished_concrete",
    wallMaterial: "rough_rock",
    rugTone: "alt",
    lighting: {
      sky: "#FFE7C2",
      ground: "#3A3632",
      ambient: 0.55,
      pendant: "#FFD9A0",
      pendantIntensity: 1.2,
      lamp: "#FFC27A",
      accent: "#2EC4B6",
    },
    corner: "plant",
    wallLong: "cabinet",
    wallShort: "water_cooler",
    clutter: ["mugs", "desk_plant", "books", "mugs"],
    wallDecor: ["clock", "corkboard", "poster", "shelf"],
    models: models("ops_room", {
      shared_table: "console-desk",
      chair: "swivel-chair",
      cabinet: "filing-cabinet",
      water_cooler: "water-cooler",
      plant: "potted-fern",
      plant_small: "desk-fern",
      floor_lamp: "tripod-lamp",
      poster: "world-map",
    }),
  },
  lab: {
    id: "lab",
    name: "Lab",
    blurb: "Lab benches, specimen shelves and planters under cool white light on tiles.",
    palette: palette(
      {
        floor: "#C9CED1",
        floorAlt: "#AEB6BA",
        wall: "#8C8F8E",
        wallAlt: "#9DA19F",
        accent: "#7FD1E8",
        exterior: "#5B5E5D",
        cap: "#2B2B2E",
      },
      "lair-lab",
      "Lab: white tile and concrete, cool cyan",
    ),
    floorMaterial: "lab_tile",
    wallMaterial: "poured_concrete",
    rugTone: "light",
    lighting: {
      sky: "#EAF4FF",
      ground: "#5A6066",
      ambient: 0.7,
      pendant: "#F2F8FF",
      pendantIntensity: 1.4,
      lamp: "#FFE9C4",
      accent: "#7FD1E8",
    },
    corner: "plant",
    wallLong: "bookshelf",
    wallShort: "plant_small",
    clutter: ["desk_plant", "books", "desk_plant", "mugs"],
    wallDecor: ["poster", "clock", "shelf", "corkboard"],
    models: models("lab", {
      shared_table: "lab-bench",
      chair: "lab-stool-chair",
      cabinet: "reagent-locker",
      bookshelf: "specimen-shelf",
      plant: "specimen-planter",
      plant_small: "seedling-tray",
      floor_lamp: "inspection-lamp",
      poster: "periodic-chart",
    }),
  },
  workshop: {
    id: "workshop",
    name: "Workshop",
    blurb: "Workbenches, tool chests and crates on steel plate, under warm work lights.",
    palette: palette(
      {
        floor: "#55524C",
        floorAlt: "#6A655C",
        wall: "#7A6A58",
        wallAlt: "#8A7A66",
        accent: "#F2C200",
        exterior: "#4A4038",
        cap: "#2B2B2E",
      },
      "lair-workshop",
      "Workshop: steel plate and rock, henchman yellow",
    ),
    floorMaterial: "steel_plate",
    wallMaterial: "rough_rock",
    rugTone: "wood",
    lighting: {
      sky: "#FFD9A8",
      ground: "#3A3228",
      ambient: 0.5,
      pendant: "#FFB866",
      pendantIntensity: 1.3,
      lamp: "#FFAA55",
      accent: "#F2C200",
    },
    corner: "cabinet",
    wallLong: "counter",
    wallShort: "cabinet",
    clutter: ["mugs", "books", "fruit_bowl", "mugs"],
    wallDecor: ["shelf", "clock", "poster", "corkboard"],
    models: models("workshop", {
      shared_table: "workbench-desk",
      chair: "shop-stool-chair",
      cabinet: "tool-chest",
      counter: "workbench",
      plant: "oil-drum-plant",
      plant_small: "cactus-tin",
      floor_lamp: "work-light",
      poster: "blueprint",
      corner: "crate-stack",
      wallShort: "barrel",
    }),
  },
  war_room: {
    id: "war_room",
    name: "War room",
    blurb: "Brass, dark carpet, map chests and potted palms; a red beacon over the boards.",
    palette: palette(
      {
        floor: "#4A2C29",
        floorAlt: "#3A2220",
        wall: "#4F4A45",
        wallAlt: "#5C5650",
        accent: "#D7263D",
        exterior: "#3A3430",
        cap: "#C9A227",
      },
      "lair-war-room",
      "War room: dark carpet and rock, alarm red and brass",
    ),
    floorMaterial: "war_carpet",
    wallMaterial: "riveted_steel",
    rugTone: "warm",
    lighting: {
      sky: "#FFD2A0",
      ground: "#2A2020",
      ambient: 0.45,
      pendant: "#FFC98A",
      pendantIntensity: 1.1,
      lamp: "#FFB070",
      accent: "#D7263D",
    },
    corner: "plant",
    wallLong: "bookshelf",
    wallShort: "plant_small",
    clutter: ["books", "fruit_bowl", "books", "mugs"],
    wallDecor: ["poster", "clock", "corkboard", "shelf"],
    models: models("war_room", {
      shared_table: "briefing-desk",
      chair: "leather-chair",
      cabinet: "map-chest",
      bookshelf: "map-cabinet",
      plant: "potted-palm",
      plant_small: "brass-pot",
      floor_lamp: "brass-lamp",
      poster: "campaign-map",
    }),
  },
};

export function decorStyleSpec(style: DecorStyle): DecorStyleSpec {
  return DECOR_STYLE_SPECS[style];
}

export const DECOR_STYLE_IDS: readonly DecorStyle[] = DECOR_STYLES;

/**
 * Model id for a piece: the style's model for `role` (a site role such as
 * `corner`, when the style uses one), else for `kind`, else the common one.
 */
export function styleModel(spec: DecorStyleSpec, kind: string, role?: string): string {
  return (role && spec.models[role]) || spec.models[kind] || `lair/common/${kind}`;
}
