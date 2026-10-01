/**
 * Model ids → lair pieces (#183): the map the room generator (#182) and the
 * compound scene (#186) use to draw furniture. Every floor-layout obstacle
 * kind has a lair model (the type makes the map exhaustive, so a new kind
 * in floor-layout fails typecheck until it is drawn), plus lair-only prop
 * kinds the generator may place (consoles, lockers, crates...). Seats map to
 * the swivel chair; the couch kind is its own seat.
 *
 * Pieces face +z (`LAIR_MODEL_HEADING`, the same as the Kenney models), so
 * `fitToFootprint` places them exactly like the current furniture, and
 * sittable models publish a `SitSpec` measured from their built mesh
 * (data-driven seat heights and sit offsets, as in #167).
 */
import {
  HEADING,
  OBSTACLE_KINDS,
  type ObstacleKind,
  type Rect,
  type SeatKind,
} from "@regulus/floor-layout";
import type { SitSpec } from "../furniture/catalog.ts";
import { centreBottomOffset, fitToFootprint } from "../furniture/placement.ts";
import { CONSOLE_LAMPS, type LampSocket, MAINFRAME_LAMPS } from "./geometry/consoles.ts";
import {
  LOUNGE_CHAIR_SEAT,
  type SitPoints,
  SOFA_SEAT,
  SWIVEL_CHAIR_SEAT,
  sitSpecFromBounds,
} from "./geometry/seating.ts";
import { type PieceId, pieceGeometry, pieceSize } from "./kit.ts";
import type { PiecePlacement } from "./placements.ts";

/** Lair-only prop kinds, beyond the floor-layout obstacle kinds, for the room generator. */
export const LAIR_PROP_KINDS = [
  "console",
  "mainframe",
  "lockers",
  "crate",
  "crate_stack",
  "barrel",
  "rock_pile",
] as const;
export type LairPropKind = (typeof LAIR_PROP_KINDS)[number];

/** Every model id the generator can reference. */
export const LAIR_MODEL_IDS = [...OBSTACLE_KINDS, ...LAIR_PROP_KINDS] as const;
export type LairModelId = ObstacleKind | LairPropKind;

/** The heading an unrotated lair piece faces (+z, south). */
export const LAIR_MODEL_HEADING = HEADING.south;

export interface LairModel {
  readonly piece: PieceId;
  /** Height when fitted to a footprint; defaults to the piece's authored height. */
  readonly targetHeight?: number;
  /** Keep proportions (scale every axis by the height ratio). */
  readonly uniform?: boolean;
  /** Where a sitter goes, for models people sit on. */
  readonly sit?: SitPoints;
  /** Blinking lamp sockets (consoles), piece-local. */
  readonly lamps?: readonly LampSocket[];
  /** Instance tint over the vertex colours. */
  readonly tint?: string;
}

export const LAIR_MODELS: Readonly<Record<LairModelId, LairModel>> = {
  desk: { piece: "pod_desk" },
  shared_table: { piece: "lab_bench" },
  ceo_desk: { piece: "command_desk" },
  meeting_table: { piece: "map_table" },
  reception_desk: { piece: "reception_counter" },
  cabinet: { piece: "filing_cabinet", uniform: true },
  bookshelf: { piece: "shelving" },
  counter: { piece: "counter" },
  fridge: { piece: "fridge" },
  coffee_machine: { piece: "espresso_machine", uniform: true },
  water_cooler: { piece: "water_cooler", uniform: true },
  bistro_table: { piece: "tulip_table" },
  coffee_table: { piece: "oval_table" },
  couch: { piece: "sofa", sit: SOFA_SEAT },
  jukebox: { piece: "jukebox", uniform: true },
  plant: { piece: "palm", uniform: true },
  plant_small: { piece: "fern", uniform: true },
  planter: { piece: "planter" },
  armchair: { piece: "lounge_chair", uniform: true, sit: LOUNGE_CHAIR_SEAT },
  floor_lamp: { piece: "arc_lamp", uniform: true },
  bench: { piece: "bench" },
  console: { piece: "console", lamps: CONSOLE_LAMPS },
  mainframe: { piece: "mainframe", lamps: MAINFRAME_LAMPS },
  lockers: { piece: "lockers" },
  crate: { piece: "crate", uniform: true },
  crate_stack: { piece: "crate_stack", uniform: true },
  barrel: { piece: "barrel", uniform: true },
  rock_pile: { piece: "rock_pile" },
};

/** The desk chair every desk, reception and loose chair seat is drawn with. */
export const LAIR_CHAIR: LairModel = {
  piece: "swivel_chair",
  uniform: true,
  sit: SWIVEL_CHAIR_SEAT,
};

/** Chair per seat kind, or null when the furniture is the seat (couch). */
export const LAIR_SEAT_MODELS: Readonly<Record<SeatKind, LairModel | null>> = {
  desk: LAIR_CHAIR,
  reception: LAIR_CHAIR,
  chair: LAIR_CHAIR,
  couch: null,
};

export function isLairModelId(id: string): id is LairModelId {
  return Object.hasOwn(LAIR_MODELS, id);
}

/** A model's `SitSpec` (fractions of its built mesh's bounds), for the sit-anchor maths. */
export function lairSitSpec(model: LairModel): SitSpec | undefined {
  if (!model.sit) return undefined;
  const { body } = pieceGeometry(model.piece);
  body.computeBoundingBox();
  const box = body.boundingBox;
  return box ? sitSpecFromBounds(box, model.sit) : undefined;
}

/**
 * Where a model goes for an obstacle footprint and heading: the same
 * `fitToFootprint` the Kenney furniture uses, with the piece's bounds
 * centred on the footprint.
 */
export function lairModelPlacement(id: LairModelId, rect: Rect, heading: number): PiecePlacement {
  const model = LAIR_MODELS[id];
  const { body } = pieceGeometry(model.piece);
  body.computeBoundingBox();
  const box = body.boundingBox;
  const fit = fitToFootprint(pieceSize(model.piece), rect, heading, {
    targetHeight: model.targetHeight ?? pieceSize(model.piece).h,
    uniform: model.uniform,
    modelHeading: LAIR_MODEL_HEADING,
  });
  return {
    piece: model.piece,
    position: fit.position,
    rotationY: fit.rotationY,
    scale: fit.scale,
    pivot: box ? centreBottomOffset(box) : undefined,
    tint: model.tint,
  };
}
