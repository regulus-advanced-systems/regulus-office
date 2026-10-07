/**
 * Dressing for the fixed special rooms (SPEC §9.1, §12; #186): the lobby
 * (reception, lounge, jukebox, consoles and the usage wall), the war room
 * (map table, console banks, campaign maps), the break room (counter,
 * espresso machine, fridge, bistro tables, lockers) and, on every level but
 * the lobby level, the lift landing (#269: the lift, its control desk, a
 * waiting nook and the supplies that came down with it). The lobby and the
 * landings share the lift's spot: it is one shaft. Hand-placed lair kit
 * pieces in the room's own frame (metres from its north-west corner),
 * measured from the walls so a lobby of another size still works. Pure data.
 */

import type { DoorSide, SpecialRoomKind } from "@regulus/protocol";
import {
  breakRoomTables,
  DIRECTION,
  HEADING,
  type LiftSpot,
  landingNook,
  liftSpot,
  type Rect,
} from "@regulus/room-layout";
import type { Vec3 } from "../lair/geometry/builder.ts";
import { WALL_RELIEF } from "../lair/geometry/walls.ts";
import type { PieceId } from "../lair/kit.ts";
import { type LairModelId, lairModelPlacement } from "../lair/models.ts";
import type { PiecePlacement } from "../lair/placements.ts";

export interface FurnitureItem {
  model: LairModelId;
  rect: Rect;
  /** The way the piece faces. */
  facing: DoorSide;
}

export interface SpecialDressing {
  furniture: FurnitureItem[];
  /** Loose pieces that never block (chairs round a table, wall decor). */
  extras: PiecePlacement[];
  /** Live usage screen on a wall (the lobby's usage wall), centre and facing. */
  usage?: { position: Vec3; rotationY: number; w: number; h: number };
  /**
   * The lounge TV (#48): a console set on legs facing the sofa, its footprint
   * (blocks the nav grid) and its screen (size, centre height).
   */
  tv?: { rect: Rect; facing: DoorSide; screen: { w: number; h: number; y: number } };
  /** The lift (#269), room frame: the lobby and every landing have it at the same spot. */
  lift?: LiftSpot;
  /** A landing's stencilled level sign on the wall (#269): centre, facing and size. */
  levelSign?: { position: Vec3; rotationY: number; w: number; h: number };
  /** The compound-wide whiteboard (#45): centre, facing, size and where to stand to use it. */
  whiteboard?: {
    position: Vec3;
    rotationY: number;
    w: number;
    h: number;
    stand: { x: number; z: number };
  };
}

const R = (x: number, z: number, w: number, d: number): Rect => ({ x, z, w, d });

/** A wall-mounted piece centred `along` metres down a wall, `y` metres up, facing into the room. */
export function wallPiece(
  piece: PieceId,
  side: DoorSide,
  along: number,
  y: number,
  size: { w: number; d: number },
): PiecePlacement {
  const inward = DIRECTION[opposite(side)];
  const off = WALL_RELIEF.rock + 0.02;
  const base =
    side === "north"
      ? { x: along, z: 0 }
      : side === "south"
        ? { x: along, z: size.d }
        : side === "west"
          ? { x: 0, z: along }
          : { x: size.w, z: along };
  return {
    piece,
    position: [base.x + inward.x * off, y, base.z + inward.z * off],
    rotationY: Math.atan2(inward.x, inward.z),
  };
}

function opposite(side: DoorSide): DoorSide {
  return side === "north"
    ? "south"
    : side === "south"
      ? "north"
      : side === "east"
        ? "west"
        : "east";
}

/** A loose chair at a point, facing a direction. */
function chair(piece: PieceId, x: number, z: number, facing: DoorSide): PiecePlacement {
  return { piece, position: [x, 0, z], rotationY: HEADING[facing] + Math.PI };
}

function lobby(w: number, d: number): SpecialDressing {
  const size = { w, d };
  return {
    furniture: [
      // Reception against the west wall, facing the room; the PM's home (M5).
      { model: "reception_desk", rect: R(1.4, d / 2 - 3, 1.3, 5), facing: "east" },
      { model: "console", rect: R(0.4, 1.2, 1.1, 2.4), facing: "east" },
      { model: "mainframe", rect: R(0.4, d - 3.4, 0.9, 2.2), facing: "east" },
      // Lounge in the east half: sofa, armchairs, a coffee table and a lamp.
      { model: "couch", rect: R(w - 7.6, d - 3.6, 4, 1.1), facing: "north" },
      { model: "armchair", rect: R(w - 9.4, d - 6.4, 1.1, 1.1), facing: "east" },
      { model: "armchair", rect: R(w - 2.6, d - 6.4, 1.1, 1.1), facing: "west" },
      { model: "coffee_table", rect: R(w - 6.6, d - 6.6, 2, 1.2), facing: "north" },
      { model: "floor_lamp", rect: R(w - 2.4, d - 3.4, 0.7, 0.7), facing: "west" },
      { model: "jukebox", rect: R(w - 4.6, 0.5, 1.2, 0.8), facing: "south" },
      // Plants in the corners; a bench and a planter by the blast door, clear of its button.
      { model: "plant", rect: R(0.5, 0.4, 0.9, 0.9), facing: "south" },
      { model: "plant", rect: R(w - 1.4, 0.4, 0.9, 0.9), facing: "south" },
      { model: "plant", rect: R(w - 1.4, d - 1.3, 0.9, 0.9), facing: "north" },
      { model: "planter", rect: R(w / 2 - 8.2, d - 1.1, 2, 0.6), facing: "north" },
      { model: "planter", rect: R(w / 2 + 4.3, d - 1.1, 2.2, 0.6), facing: "north" },
      { model: "bench", rect: R(1.6, d - 1.1, 2.2, 0.6), facing: "north" },
    ],
    extras: [
      chair("swivel_chair", 0.95, d / 2 - 0.5, "east"),
      wallPiece("poster", "north", 3.5, 1.7, size),
      wallPiece("wall_clock", "north", w / 2 - 3.5, 2.3, size),
      // South of the lift, over the lounge.
      wallPiece("poster_world_map", "east", d / 2 + 2.2, 1.6, size),
      wallPiece("pinboard", "west", d / 2 + 4, 1.5, size),
    ],
    lift: liftSpot(w, d),
    usage: (() => {
      const p = wallPiece("usage_panel", "north", w / 2 + 4.5, 1.65, size);
      return { position: p.position, rotationY: p.rotationY ?? 0, w: 2.4, h: 1.35 };
    })(),
    // Across the coffee table from the sofa, centred on it (#48).
    tv: {
      rect: R(w - 6.8, d - 8.6, 2.4, 0.6),
      facing: "south",
      screen: { w: 2, h: 1.12, y: 1.36 },
    },
    // West of the corridor door, between the poster and the clock (#45).
    whiteboard: (() => {
      const along = Math.min(6, w / 2 - 4.5);
      const p = wallPiece("whiteboard", "north", along, 1.5, size);
      return {
        position: p.position,
        rotationY: p.rotationY ?? 0,
        w: 2.4,
        h: 1.3,
        stand: { x: along, z: 1.3 },
      };
    })(),
  };
}

function conference(w: number, d: number): SpecialDressing {
  const size = { w, d };
  const table = R(w / 2 - 3, d / 2 - 1, 6, 2.6);
  const extras: PiecePlacement[] = [];
  for (let i = 0; i < 3; i++) {
    const x = table.x + 1 + i * 2;
    extras.push(chair("leather_chair", x, table.z - 0.7, "south"));
    extras.push(chair("leather_chair", x, table.z + table.d + 0.7, "north"));
  }
  extras.push(chair("leather_chair", table.x - 0.7, table.z + table.d / 2, "east"));
  extras.push(chair("leather_chair", table.x + table.w + 0.7, table.z + table.d / 2, "west"));
  extras.push(
    wallPiece("poster_campaign", "west", d / 2, 1.6, size),
    wallPiece("poster_world_map", "east", d / 2, 1.6, size),
    wallPiece("wall_clock", "north", 3, 2.3, size),
  );
  return {
    furniture: [
      { model: "meeting_table", rect: table, facing: "south" },
      // Console banks along the back wall; the door is in the north wall.
      { model: "console", rect: R(2, d - 1.3, 2.4, 1), facing: "north" },
      { model: "console", rect: R(w / 2 - 1.2, d - 1.3, 2.4, 1), facing: "north" },
      { model: "console", rect: R(w - 4.4, d - 1.3, 2.4, 1), facing: "north" },
      { model: "mainframe", rect: R(0.4, 1, 0.9, 2.2), facing: "east" },
      { model: "mainframe", rect: R(w - 1.3, 1, 0.9, 2.2), facing: "west" },
      { model: "plant", rect: R(0.5, d - 1.4, 0.9, 0.9), facing: "north" },
      { model: "plant", rect: R(w - 1.4, d - 1.4, 0.9, 0.9), facing: "north" },
    ],
    extras,
  };
}

function breakRoom(w: number, d: number): SpecialDressing {
  const size = { w, d };
  const extras: PiecePlacement[] = [];
  const tables: FurnitureItem[] = [];
  for (const [tx, tz] of breakRoomTables(w, d)) {
    tables.push({ model: "bistro_table", rect: R(tx, tz, 1, 1), facing: "south" });
    extras.push(chair("stool_chair", tx - 0.45, tz + 0.5, "east"));
    extras.push(chair("stool_chair", tx + 1.45, tz + 0.5, "west"));
  }
  extras.push(
    wallPiece("poster_elements", "west", d / 2, 1.6, size),
    wallPiece("wall_shelf", "east", d / 2 + 3.5, 1.7, size),
    wallPiece("wall_clock", "north", 2.5, 2.3, size),
  );
  return {
    furniture: [
      { model: "counter", rect: R(w - 1.2, 2, 0.9, 5), facing: "west" },
      { model: "coffee_machine", rect: R(w - 1.1, 7.3, 0.7, 0.7), facing: "west" },
      { model: "fridge", rect: R(w - 1.3, 8.4, 0.9, 0.9), facing: "west" },
      { model: "water_cooler", rect: R(0.5, 2, 0.6, 0.6), facing: "east" },
      { model: "lockers", rect: R(2.5, d - 1, 3.6, 0.6), facing: "north" },
      { model: "lockers", rect: R(w - 6.5, d - 1, 3.6, 0.6), facing: "north" },
      { model: "couch", rect: R(0.5, d / 2 - 1, 1.1, 3.4), facing: "east" },
      { model: "plant", rect: R(0.5, 0.4, 0.9, 0.9), facing: "south" },
      { model: "plant_small", rect: R(w - 1.2, d - 1.1, 0.7, 0.7), facing: "north" },
      ...tables,
    ],
    extras,
  };
}

/**
 * A level's landing: the hall the lift opens into. Not a second lobby: no
 * reception, jukebox, TV or blast door. The lift and its control desk on the
 * east wall, a waiting nook in front of it, lockers and the crates and drums
 * that came down with the last load along the west side, and the level's
 * name stencilled on the north wall beside the door to the corridors.
 */
function landing(w: number, d: number): SpecialDressing {
  const size = { w, d };
  const lift = liftSpot(w, d);
  const nook = landingNook(w, d);
  const sign = wallPiece("pinboard", "north", w / 2 + 5.4, 1.95, size);
  return {
    furniture: [
      // The lift's control desk, south of the shaft.
      {
        model: "console",
        rect: R(w - 1.5, lift.rect.z + lift.rect.d + 0.7, 1.1, 2.4),
        facing: "west",
      },
      // Waiting nook: two armchairs across a table, a lamp, in sight of the lift.
      { model: "armchair", rect: R(nook.west.x, nook.west.z, 1.1, 1.1), facing: "east" },
      { model: "armchair", rect: R(nook.east.x, nook.east.z, 1.1, 1.1), facing: "west" },
      { model: "coffee_table", rect: R(nook.table.x, nook.table.z, 2, 1.2), facing: "north" },
      { model: "floor_lamp", rect: R(w - 5, d - 5.4, 0.7, 0.7), facing: "west" },
      // Staging along the west side: lockers, a mainframe, the last load of supplies.
      { model: "lockers", rect: R(0.4, 2.4, 0.6, 3.6), facing: "east" },
      { model: "mainframe", rect: R(0.4, d / 2 + 0.6, 0.9, 2.2), facing: "east" },
      { model: "crate_stack", rect: R(2.4, d - 3.6, 1.8, 1.8), facing: "north" },
      { model: "crate", rect: R(4.7, d - 2.3, 1, 1), facing: "north" },
      { model: "barrel", rect: R(1, d - 4.9, 0.7, 0.7), facing: "north" },
      { model: "barrel", rect: R(1.9, d - 5.5, 0.7, 0.7), facing: "north" },
      { model: "water_cooler", rect: R(w - 1.2, 1.4, 0.6, 0.6), facing: "west" },
      { model: "crate", rect: R(w - 1.5, lift.rect.z - 1.5, 1, 1), facing: "west" },
      { model: "bench", rect: R(0.5, d / 2 - 1.7, 0.6, 2.2), facing: "east" },
      // Where the lobby has its blast door this deep is solid rock: a bench between planters.
      { model: "bench", rect: R(w / 2 - 1.1, d - 1.1, 2.2, 0.6), facing: "north" },
      { model: "planter", rect: R(w / 2 - 4.4, d - 1.1, 2, 0.6), facing: "north" },
      { model: "planter", rect: R(w / 2 + 2.4, d - 1.1, 2, 0.6), facing: "north" },
      { model: "plant", rect: R(0.5, 0.4, 0.9, 0.9), facing: "south" },
      { model: "plant", rect: R(w - 1.4, d - 1.3, 0.9, 0.9), facing: "north" },
      { model: "plant_small", rect: R(0.5, d - 1.2, 0.7, 0.7), facing: "north" },
    ],
    extras: [
      wallPiece("wall_clock", "north", w / 2 - 3.5, 2.3, size),
      wallPiece("poster_blueprint", "west", d / 2 - 1.2, 1.6, size),
      wallPiece("pinboard", "north", 3.5, 1.5, size),
      wallPiece("vent", "east", d - 2.5, 2.2, size),
    ],
    lift,
    levelSign: { position: sign.position, rotationY: sign.rotationY ?? 0, w: 4.4, h: 1.1 },
  };
}

/** The dressing of a special room of `w × d` metres. */
export function specialDressing(kind: SpecialRoomKind, w: number, d: number): SpecialDressing {
  if (kind === "lobby") return lobby(w, d);
  if (kind === "landing") return landing(w, d);
  if (kind === "conference") return conference(w, d);
  return breakRoom(w, d);
}

/** Furniture placements (lair pieces) of a dressing. */
export function dressingPieces(dressing: SpecialDressing): PiecePlacement[] {
  return [
    ...dressing.furniture.map((f) => lairModelPlacement(f.model, f.rect, HEADING[f.facing])),
    ...dressing.extras,
  ];
}
