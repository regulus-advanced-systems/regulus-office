/**
 * Dressing for the fixed special rooms (SPEC §9.1, §12; #186): the lobby
 * (reception, lounge, jukebox, consoles and the usage wall), the war room
 * (map table, console banks, campaign maps) and the break room (counter,
 * espresso machine, fridge, bistro tables, lockers). Hand-placed lair kit
 * pieces in the room's own frame (metres from its north-west corner),
 * measured from the walls so a lobby of another size still works. Pure data.
 */
import { DIRECTION, HEADING, type Rect } from "@regulus/floor-layout";
import type { DoorSide, SpecialRoomKind } from "@regulus/protocol";
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
      wallPiece("poster_world_map", "east", d / 2 - 2.5, 1.6, size),
      wallPiece("pinboard", "west", d / 2 + 4, 1.5, size),
    ],
    usage: (() => {
      const p = wallPiece("usage_panel", "north", w / 2 + 4.5, 1.65, size);
      return { position: p.position, rotationY: p.rotationY ?? 0, w: 2.4, h: 1.35 };
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
  for (const [tx, tz] of [
    [w / 2 - 3, d / 2 - 2],
    [w / 2 + 1.5, d / 2 - 2],
    [w / 2 - 1, d / 2 + 2.2],
  ] as const) {
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

/** The dressing of a special room of `w × d` metres. */
export function specialDressing(kind: SpecialRoomKind, w: number, d: number): SpecialDressing {
  if (kind === "lobby") return lobby(w, d);
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
