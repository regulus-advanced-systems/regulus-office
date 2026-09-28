/**
 * Which placeholder model (Kenney Furniture Kit, CC0; see
 * packages/assets/models/furniture/README.md) stands in for each floor-layout
 * kind, and how to size it. Kinds missing here are drawn procedurally.
 *
 * Models are referenced with `new URL(..., import.meta.url)` so Vite bundles
 * them from the assets package without any config.
 */
import type { ObstacleKind, SeatKind } from "@regulus/floor-layout";

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
} as const;

/** Kenney's kit is exported facing -z; our default "front" is +z (toward the camera). */
const KENNEY_HEADING = 0;

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
};

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
};
