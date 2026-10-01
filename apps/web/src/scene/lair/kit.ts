/**
 * The lair art kit's piece registry (#183): every piece id, how to build it,
 * its category, whether it is cut away with the walls, and its triangle
 * budget (see budget.ts). Geometry is built once per id on first use and
 * shared by every instance; never dispose it from a component.
 */

import {
  arcLamp,
  counter,
  espressoMachine,
  filingCabinet,
  fridge,
  jukebox,
  ovalCoffeeTable,
  shelving,
  tulipTable,
  waterCooler,
} from "./geometry/amenities.ts";
import type { PieceGeometry } from "./geometry/builder.ts";
import { controlConsole, mainframe } from "./geometry/consoles.ts";
import { barrier, cableDrum, crateStack, scaffold, workLight } from "./geometry/construction.ts";
import {
  commandDesk,
  labBench,
  laptop,
  mapTable,
  podDesk,
  receptionCounter,
} from "./geometry/desks.ts";
import { doorFrame, doorLeaf } from "./geometry/doors.ts";
import {
  beacon,
  cableTray,
  ceilingBeam,
  ceilingLight,
  pipeElbow,
  pipeRun,
  vent,
  wallLamp,
} from "./geometry/fixtures.ts";
import { concreteFloor, hazardStrip, steelFloor } from "./geometry/floors.ts";
import { bench, loungeChair, sofa, swivelChair } from "./geometry/seating.ts";
import { barrel, crate, lockers, planter, pottedFern, pottedPalm } from "./geometry/storage.ts";
import {
  cactusTin,
  carpetFloor,
  deskBooks,
  deskMugs,
  deskPlant,
  drumPlanter,
  fruitBowl,
  leatherChair,
  mapChest,
  seedlingTray,
  stoolChair,
  tileFloor,
  toolChest,
  workbench,
} from "./geometry/styleProps.ts";
import {
  pictureFrame,
  pinboard,
  poster,
  usagePanel,
  wallClock,
  wallShelf,
  whiteboard,
} from "./geometry/wallDecor.ts";
import {
  concreteWall,
  rockPile,
  rockWall,
  steelWall,
  wallPillar,
  wallTrim,
} from "./geometry/walls.ts";
import { flatTile, LITE_FLOORS } from "./lite.ts";
import { LAIR } from "./palette.ts";

export const PIECE_CATEGORIES = [
  "structure",
  "wall_decor",
  "fixture",
  "furniture",
  "clutter",
  "construction",
] as const;
export type PieceCategory = (typeof PIECE_CATEGORIES)[number];

export interface PieceDef {
  readonly build: () => PieceGeometry;
  readonly category: PieceCategory;
  /** Maximum triangles for body + glow; checked by kit.test.ts. */
  readonly budget: number;
  /** Wall-mounted or part of a wall: faded by the cutaway material. */
  readonly cutaway?: boolean;
  /** Short human label for the debug scene. */
  readonly label: string;
}

const def = (
  label: string,
  category: PieceCategory,
  budget: number,
  build: () => PieceGeometry,
  cutaway = false,
): PieceDef => ({ label, category, budget, build, cutaway });

export const PIECES = {
  // Structure: walls, trims, floors, doors.
  wall_rock: def("Rock wall", "structure", 160, () => rockWall(1), true),
  wall_rock_b: def("Rock wall B", "structure", 160, () => rockWall(9), true),
  wall_concrete: def("Concrete wall", "structure", 120, () => concreteWall(), true),
  wall_steel: def("Steel wall", "structure", 300, () => steelWall(), true),
  wall_trim: def("Edge trim", "structure", 60, wallTrim, true),
  wall_pillar: def("Pillar", "structure", 80, wallPillar, true),
  floor_concrete: def("Concrete", "structure", 60, () => concreteFloor()),
  floor_concrete_worn: def("Worn concrete", "structure", 80, () => concreteFloor(15, true)),
  floor_steel: def("Steel deck", "structure", 200, () => steelFloor()),
  hazard_strip: def("Hazard strip", "structure", 40, hazardStrip),
  door_frame: def("Door frame", "structure", 320, () => doorFrame(1), true),
  door_frame_wide: def("Wide door frame", "structure", 520, () => doorFrame(2), true),
  door_leaf: def("Door leaf", "structure", 180, doorLeaf),
  rock_pile: def("Rubble", "clutter", 120, () => rockPile()),
  // Fixtures: lights, beacon, pipes, cables, vents.
  wall_lamp: def("Wall lamp", "fixture", 300, wallLamp, true),
  ceiling_light: def("Pendant light", "fixture", 280, ceilingLight, true),
  ceiling_beam: def("Ceiling beam", "fixture", 40, ceilingBeam, true),
  beacon: def("Alarm beacon", "fixture", 240, beacon, true),
  pipe_run: def("Pipe run", "fixture", 500, pipeRun, true),
  pipe_elbow: def("Pipe elbow", "fixture", 420, pipeElbow, true),
  cable_tray: def("Cable tray", "fixture", 180, cableTray, true),
  vent: def("Wall vent", "fixture", 120, vent, true),
  // Consoles and furniture.
  console: def("Control console", "furniture", 1040, controlConsole),
  mainframe: def("Tape mainframe", "furniture", 560, mainframe),
  pod_desk: def("Pod desk", "furniture", 400, podDesk),
  lab_bench: def("Lab bench", "furniture", 420, labBench),
  command_desk: def("Command desk", "furniture", 620, commandDesk),
  map_table: def("Map table", "furniture", 200, mapTable),
  reception_counter: def("Reception", "furniture", 160, receptionCounter),
  laptop: def("Laptop", "furniture", 120, laptop),
  swivel_chair: def("Swivel chair", "furniture", 400, swivelChair),
  lounge_chair: def("Lounge chair", "furniture", 200, loungeChair),
  sofa: def("Sofa", "furniture", 240, sofa),
  bench: def("Bench", "furniture", 140, bench),
  filing_cabinet: def("Filing cabinet", "furniture", 280, filingCabinet),
  shelving: def("Shelving", "furniture", 680, shelving),
  counter: def("Break counter", "furniture", 340, counter),
  fridge: def("Fridge", "furniture", 120, fridge),
  espresso_machine: def("Espresso", "furniture", 340, espressoMachine),
  water_cooler: def("Water cooler", "furniture", 180, waterCooler),
  tulip_table: def("Tulip table", "furniture", 240, tulipTable),
  oval_table: def("Oval table", "furniture", 220, ovalCoffeeTable),
  jukebox: def("Jukebox", "furniture", 300, jukebox),
  arc_lamp: def("Arc lamp", "furniture", 380, arcLamp),
  // Clutter and plants.
  lockers: def("Lockers", "clutter", 300, lockers),
  crate: def("Crate", "clutter", 520, () => crate()),
  barrel: def("Oil drum", "clutter", 480, barrel),
  palm: def("Potted palm", "clutter", 340, () => pottedPalm()),
  fern: def("Potted fern", "clutter", 180, () => pottedFern()),
  planter: def("Planter", "clutter", 180, () => planter()),
  // Build phase.
  scaffold: def("Scaffold bay", "construction", 560, scaffold),
  barrier: def("Barrier", "construction", 280, barrier),
  work_light: def("Work light", "construction", 100, workLight),
  crate_stack: def("Crate stack", "construction", 1560, crateStack),
  cable_drum: def("Cable drum", "construction", 240, cableDrum),
  // Generated-room dressings (#182 model ids): wall decor, desk clutter, style pieces.
  wall_clock: def("Wall clock", "wall_decor", 400, wallClock, true),
  pinboard: def("Pinboard", "wall_decor", 220, pinboard, true),
  poster: def("Lair poster", "wall_decor", 120, () => poster("propaganda"), true),
  poster_world_map: def("World map", "wall_decor", 120, () => poster("world_map"), true),
  poster_elements: def("Element chart", "wall_decor", 160, () => poster("element_chart"), true),
  poster_blueprint: def("Blueprint", "wall_decor", 280, () => poster("blueprint"), true),
  poster_campaign: def("Campaign map", "wall_decor", 120, () => poster("campaign_map"), true),
  wall_shelf: def("Wall shelf", "wall_decor", 200, wallShelf, true),
  whiteboard: def("Whiteboard", "wall_decor", 160, whiteboard, true),
  usage_panel: def("Usage panel", "wall_decor", 160, usagePanel, true),
  picture_frame: def("Picture frame", "wall_decor", 80, pictureFrame, true),
  desk_plant: def("Desk plant", "clutter", 120, deskPlant),
  desk_mugs: def("Mugs", "clutter", 180, deskMugs),
  fruit_bowl: def("Fruit bowl", "clutter", 240, fruitBowl),
  desk_books: def("Book stack", "clutter", 60, deskBooks),
  workbench: def("Workbench", "furniture", 300, () => workbench(0.9)),
  workbench_desk: def("Workbench desk", "furniture", 300, () => workbench(0.76)),
  stool_chair: def("Stool chair", "furniture", 200, stoolChair),
  leather_chair: def("Leather chair", "furniture", 280, leatherChair),
  map_chest: def("Map chest", "furniture", 120, mapChest),
  tool_chest: def("Tool chest", "furniture", 300, toolChest),
  fern_brass: def("Fern in brass", "clutter", 300, () => pottedFern(57, LAIR.brass)),
  seedling_tray: def("Seedling tray", "clutter", 300, seedlingTray),
  cactus_tin: def("Cactus tin", "clutter", 200, cactusTin),
  drum_planter: def("Drum planter", "clutter", 440, drumPlanter),
  floor_tile: def("Lab tile", "structure", 60, tileFloor),
  floor_carpet: def("War carpet", "structure", 30, carpetFloor),
} as const satisfies Record<string, PieceDef>;

export type PieceId = keyof typeof PIECES;
export const PIECE_IDS = Object.keys(PIECES) as PieceId[];

export function isPieceId(id: string): id is PieceId {
  return Object.hasOwn(PIECES, id);
}

const built = new Map<PieceId, PieceGeometry>();

/** The shared geometry of a piece (built on first use). */
export function pieceGeometry(id: PieceId): PieceGeometry {
  let g = built.get(id);
  if (!g) {
    g = PIECES[id].build();
    built.set(id, g);
  }
  return g;
}

const flat = new Map<PieceId, PieceGeometry>();

/** The geometry to draw: the floors' flat stand-ins when `lite` (low tier, lite.ts), else the piece's own. */
export function drawnGeometry(id: PieceId, lite: boolean): PieceGeometry {
  if (!lite || !LITE_FLOORS.has(id)) return pieceGeometry(id);
  let g = flat.get(id);
  if (!g) {
    g = flatTile(pieceGeometry(id));
    flat.set(id, g);
  }
  return g;
}

export interface PieceSize {
  w: number;
  h: number;
  d: number;
}

/** A piece's bounds (body and glow), metres; what `fitToFootprint` scales from. */
export function pieceSize(id: PieceId): PieceSize {
  const { body, glow } = pieceGeometry(id);
  body.computeBoundingBox();
  const box = body.boundingBox?.clone();
  if (!box) return { w: 0, h: 0, d: 0 };
  if (glow) {
    glow.computeBoundingBox();
    if (glow.boundingBox) box.union(glow.boundingBox);
  }
  return { w: box.max.x - box.min.x, h: box.max.y - box.min.y, d: box.max.z - box.min.z };
}
