/**
 * Which placeholder model (Kenney Furniture Kit, CC0; see
 * packages/assets/models/furniture/README.md) stands in for each floor-layout
 * kind, and how to size it. Kinds missing here are drawn procedurally.
 *
 * Models are referenced with `new URL(..., import.meta.url)` so Vite bundles
 * them from the assets package without any config.
 */
import { HEADING, type ObstacleKind, type SeatKind } from "@regulus/floor-layout";

export interface ModelSpec {
  /** Resolved asset URL. */
  readonly url: string;
  /** Height the model is scaled to, metres. */
  readonly targetHeight: number;
  /** Keep the model's proportions (scale all axes from the height). */
  readonly uniform?: boolean;
  /** Heading (three.js rotation.y) the raw model faces; default faces +z. */
  readonly modelHeading?: number;
}

/** Plain string literals: Vite only rewrites `new URL()` it can analyse statically. */
export const MODEL_URLS = {
  desk: new URL("../../../../../packages/assets/models/furniture/desk.glb", import.meta.url).href,
  chairDesk: new URL(
    "../../../../../packages/assets/models/furniture/chairDesk.glb",
    import.meta.url,
  ).href,
  kitchenCabinet: new URL(
    "../../../../../packages/assets/models/furniture/kitchenCabinet.glb",
    import.meta.url,
  ).href,
  kitchenCoffeeMachine: new URL(
    "../../../../../packages/assets/models/furniture/kitchenCoffeeMachine.glb",
    import.meta.url,
  ).href,
  loungeSofa: new URL(
    "../../../../../packages/assets/models/furniture/loungeSofa.glb",
    import.meta.url,
  ).href,
  tableCoffee: new URL(
    "../../../../../packages/assets/models/furniture/tableCoffee.glb",
    import.meta.url,
  ).href,
  pottedPlant: new URL(
    "../../../../../packages/assets/models/furniture/pottedPlant.glb",
    import.meta.url,
  ).href,
  televisionModern: new URL(
    "../../../../../packages/assets/models/furniture/televisionModern.glb",
    import.meta.url,
  ).href,
  plantSmall1: new URL(
    "../../../../../packages/assets/models/furniture/plantSmall1.glb",
    import.meta.url,
  ).href,
  plantSmall2: new URL(
    "../../../../../packages/assets/models/furniture/plantSmall2.glb",
    import.meta.url,
  ).href,
  plantSmall3: new URL(
    "../../../../../packages/assets/models/furniture/plantSmall3.glb",
    import.meta.url,
  ).href,
  loungeChair: new URL(
    "../../../../../packages/assets/models/furniture/loungeChair.glb",
    import.meta.url,
  ).href,
  lampRoundFloor: new URL(
    "../../../../../packages/assets/models/furniture/lampRoundFloor.glb",
    import.meta.url,
  ).href,
  kitchenFridge: new URL(
    "../../../../../packages/assets/models/furniture/kitchenFridge.glb",
    import.meta.url,
  ).href,
  tableRound: new URL(
    "../../../../../packages/assets/models/furniture/tableRound.glb",
    import.meta.url,
  ).href,
  table: new URL("../../../../../packages/assets/models/furniture/table.glb", import.meta.url).href,
  benchCushion: new URL(
    "../../../../../packages/assets/models/furniture/benchCushion.glb",
    import.meta.url,
  ).href,
  books: new URL("../../../../../packages/assets/models/furniture/books.glb", import.meta.url).href,
} as const;

/**
 * Every Kenney Furniture Kit model is exported with its front toward +z: the
 * chair's seat, the sofa's cushions, the desk's drawers, the cabinet and
 * fridge doors and the TV screen (#143 checked each one rendered on its own).
 * In our heading convention +z is south.
 */
export const KENNEY_HEADING = HEADING.south;

export const FURNITURE_MODELS: Partial<Record<ObstacleKind, ModelSpec>> = {
  reception_desk: { url: MODEL_URLS.desk, targetHeight: 0.76, modelHeading: KENNEY_HEADING },
  desk: { url: MODEL_URLS.desk, targetHeight: 0.76, modelHeading: KENNEY_HEADING },
  counter: { url: MODEL_URLS.kitchenCabinet, targetHeight: 0.9, modelHeading: KENNEY_HEADING },
  coffee_machine: {
    url: MODEL_URLS.kitchenCoffeeMachine,
    targetHeight: 0.45,
    uniform: true,
    modelHeading: KENNEY_HEADING,
  },
  couch: { url: MODEL_URLS.loungeSofa, targetHeight: 0.85, modelHeading: KENNEY_HEADING },
  coffee_table: { url: MODEL_URLS.tableCoffee, targetHeight: 0.45, modelHeading: KENNEY_HEADING },
  plant: { url: MODEL_URLS.pottedPlant, targetHeight: 1.2, uniform: true },
  plant_small: { url: MODEL_URLS.plantSmall1, targetHeight: 0.6, uniform: true },
  fridge: { url: MODEL_URLS.kitchenFridge, targetHeight: 1.8, modelHeading: KENNEY_HEADING },
  bistro_table: { url: MODEL_URLS.tableRound, targetHeight: 0.75, modelHeading: KENNEY_HEADING },
  meeting_table: { url: MODEL_URLS.table, targetHeight: 0.76, modelHeading: KENNEY_HEADING },
  armchair: {
    url: MODEL_URLS.loungeChair,
    targetHeight: 0.8,
    uniform: true,
    modelHeading: KENNEY_HEADING,
  },
  floor_lamp: { url: MODEL_URLS.lampRoundFloor, targetHeight: 1.6, uniform: true },
  bench: { url: MODEL_URLS.benchCushion, targetHeight: 0.45, modelHeading: KENNEY_HEADING },
};

/** Small plants rotate through the kit's three variants so a group does not look copy-pasted. */
export const SMALL_PLANT_URLS = [
  MODEL_URLS.plantSmall1,
  MODEL_URLS.plantSmall2,
  MODEL_URLS.plantSmall3,
] as const;

/** Pick a small-plant variant from an id (stable across renders). */
export function smallPlantUrl(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SMALL_PLANT_URLS[h % SMALL_PLANT_URLS.length] as string;
}

export const CHAIR_MODEL: ModelSpec = {
  url: MODEL_URLS.chairDesk,
  targetHeight: 0.9,
  uniform: true,
  modelHeading: KENNEY_HEADING,
};

export const TV_MODEL: ModelSpec = {
  url: MODEL_URLS.televisionModern,
  targetHeight: 1,
  uniform: true,
  modelHeading: KENNEY_HEADING,
};

/** Chair to draw at a seat, or null when the furniture itself is the seat (couch). */
export function chairForSeat(kind: SeatKind): ModelSpec | null {
  return kind === "couch" ? null : CHAIR_MODEL;
}

/** Box height for kinds drawn procedurally (jukebox has its own component). */
export const PLACEHOLDER_HEIGHTS: Readonly<Record<ObstacleKind, number>> = {
  desk: 0.76,
  shared_table: 0.76,
  ceo_desk: 0.76,
  meeting_table: 0.76,
  reception_desk: 0.76,
  cabinet: 1.3,
  bookshelf: 1.8,
  counter: 0.9,
  fridge: 1.8,
  coffee_machine: 0.45,
  water_cooler: 1.2,
  bistro_table: 0.75,
  coffee_table: 0.45,
  couch: 0.85,
  jukebox: 1.5,
  plant: 1.2,
  plant_small: 0.6,
  planter: 0.45,
  armchair: 0.8,
  floor_lamp: 1.6,
  bench: 0.45,
};
