/**
 * What each room of the compound looks like (#186), in the room's own frame:
 * - an open project room: its generated interior (#182) as lair art (#183,
 *   `lairRoomScene`), door cut in its wall;
 * - a room still `building`: two walls up, scaffolding, crates and a work light;
 * - a room this viewer may not enter: the bare shell behind a closed door
 *   (the scene caps it, so the interior stays private, SPEC §9.1);
 * - the special rooms: their shell and fixed dressing (special.ts).
 * Results are cached per room and setting, so a re-render or a counter
 * change never regenerates a room. Pure.
 */
import type { Rect, RoomLayout } from "@regulus/floor-layout";
import { type RoomShell, roomShell } from "../lair/assembly.ts";
import { type WorldLamp, worldLamps } from "../lair/components/BlinkingLamps.tsx";
import { LAIR_MODELS } from "../lair/models.ts";
import type { PiecePlacement } from "../lair/placements.ts";
import { type LookItem, lairRoomScene } from "../lair/roomScene.ts";
import { roomLayout } from "./layouts.ts";
import { dressingPieces, type SpecialDressing, specialDressing } from "./special.ts";
import type { WorldRoom } from "./world.ts";

export { roomLayout };

export type RoomLook = "open" | "building" | "locked" | "special";

export interface RoomArt {
  look: RoomLook;
  /** Shell and furniture, room frame. */
  pieces: PiecePlacement[];
  /**
   * Laptops on every desk as kit pieces (one instanced draw for all): every
   * desk while the room's FloorRoom is not joined, the free desks while it is
   * (robots' desks then get the live LaptopLayer laptop with its screen).
   */
  laptops: PiecePlacement[];
  /** The desk seat of each of `laptops`, in the same order. */
  laptopSeats: string[];
  doors: RoomShell["doors"];
  beacons: RoomShell["beacons"];
  lamps: PiecePlacement[];
  consoleLamps: WorldLamp[];
  /** Board, clipboard and gong anchors (drawn by their layers when joined). */
  looks: LookItem[];
  /** Furniture footprints for the nav grid, room frame. */
  obstacles: Rect[];
  /** The generated interior of an open project room. */
  layout: RoomLayout | null;
  dressing: SpecialDressing | null;
}

/** How a room is drawn for this viewer. */
export function roomLook(room: WorldRoom): RoomLook {
  if (room.kind !== "project") return "special";
  if (room.buildState === "building") return "building";
  return room.enterable ? "open" : "locked";
}

/** Door tile along its side, from the room's own corner. */
function doorTile(room: WorldRoom): number {
  return room.doorSide === "north" || room.doorSide === "south"
    ? room.door.x - room.rect.x
    : room.door.y - room.rect.y;
}

/** A kit laptop on the desk in front of every desk seat, its screen toward the sitter. */
export function deskLaptops(layout: RoomLayout, reach = 0.72, top = 0.76): PiecePlacement[] {
  return layout.seats
    .filter((s) => s.kind === "desk")
    .map((s) => {
      const h = s.pose.heading;
      return {
        piece: "laptop",
        position: [s.pose.x - Math.sin(h) * reach, top, s.pose.z - Math.cos(h) * reach],
        rotationY: h,
      };
    });
}

function bareShell(room: WorldRoom, look: RoomLook): RoomShell {
  return roomShell({
    w: room.rect.w,
    d: room.rect.d,
    door: { side: room.doorSide, tile: doorTile(room), span: 2 },
    floor: look === "special" && room.kind === "conference" ? "floor_carpet" : "floor_concrete",
    finish:
      room.kind === "lobby"
        ? { north: "wall_concrete", south: "wall_steel" }
        : room.kind === "break_room"
          ? { north: "wall_concrete" }
          : undefined,
    lampEvery: look === "locked" ? 0 : 3,
    services: look === "special" ? ["north", "east", "west"] : [],
  });
}

const EMPTY: Omit<RoomArt, "look" | "pieces" | "doors" | "beacons" | "lamps"> = {
  laptops: [],
  laptopSeats: [],
  consoleLamps: [],
  looks: [],
  obstacles: [],
  layout: null,
  dressing: null,
};

/** A build site: the back walls up, scaffolding on the rest, crates and a work light inside. */
function buildSite(room: WorldRoom): RoomArt {
  const shell = bareShell(room, "building");
  const { w, d } = room.size;
  const up = new Set(["north", "west"]);
  const pieces = shell.pieces.filter((p) => {
    const wall = p.piece.startsWith("wall_rock") || p.piece === "wall_trim";
    if (!wall) return !p.piece.startsWith("wall_lamp");
    const [x, , z] = p.position;
    const side = z < 0 ? "north" : z > d ? "south" : x < 0 ? "west" : "east";
    return up.has(side);
  });
  const site: PiecePlacement[] = [];
  for (let x = 2; x < w - 1; x += 4)
    site.push({ piece: "scaffold", position: [x, 0, d - 0.2], rotationY: Math.PI / 2 });
  for (let z = 2; z < d - 1; z += 4) site.push({ piece: "scaffold", position: [w - 0.2, 0, z] });
  site.push(
    { piece: "crate_stack", position: [w * 0.3, 0, d * 0.35], rotationY: 0.3 },
    { piece: "crate", position: [w * 0.55, 0, d * 0.3], rotationY: -0.4 },
    { piece: "cable_drum", position: [w * 0.5, 0, d * 0.62], rotationY: 0.8 },
    { piece: "barrel", position: [w * 0.25, 0, d * 0.7] },
    { piece: "rock_pile", position: [w * 0.7, 0, d * 0.5], rotationY: 1.1 },
    { piece: "barrier", position: [w * 0.4, 0, d - 1.2] },
  );
  const light: PiecePlacement = {
    piece: "work_light",
    position: [1.2, 0, 1.2],
    rotationY: Math.PI * 0.75,
  };
  return {
    ...EMPTY,
    look: "building",
    pieces: [...pieces, ...site, light],
    doors: shell.doors,
    beacons: shell.beacons,
    lamps: [light],
  };
}

function specialRoom(room: WorldRoom): RoomArt {
  const shell = bareShell(room, "special");
  if (room.kind === "project") throw new Error("not a special room");
  const dressing = specialDressing(room.kind, room.size.w, room.size.d);
  const furniture = dressingPieces(dressing);
  const consoles = dressing.furniture
    .map((f, i) => ({ f, p: furniture[i] }))
    .filter(({ f }) => LAIR_MODELS[f.model].lamps !== undefined);
  const consoleLamps = consoles.flatMap(({ f, p }) =>
    p ? worldLamps([p], LAIR_MODELS[f.model].lamps ?? []) : [],
  );
  let pieces = [...shell.pieces, ...furniture];
  if (room.kind === "lobby") pieces = pieces.filter((p) => !isBlastDoorWall(p, room));
  return {
    ...EMPTY,
    look: "special",
    pieces,
    doors: shell.doors,
    beacons: shell.beacons,
    lamps: shell.lamps,
    consoleLamps,
    obstacles: dressing.furniture.map((f) => f.rect),
    dressing,
  };
}

/** The lobby's south wall segments the blast door replaces (the middle four tiles). */
function isBlastDoorWall(p: PiecePlacement, room: WorldRoom): boolean {
  const [x, , z] = p.position;
  if (z < room.size.d) return false;
  const mid = room.size.w / 2;
  return Math.abs(x - mid) < 4 && !p.piece.startsWith("wall_pillar");
}

function openRoom(room: WorldRoom, layout: RoomLayout): RoomArt {
  const scene = lairRoomScene(layout);
  return {
    look: "open",
    pieces: scene.pieces,
    laptops: deskLaptops(layout),
    laptopSeats: layout.seats.filter((s) => s.kind === "desk").map((s) => s.id),
    doors: scene.doors,
    beacons: scene.beacons,
    lamps: scene.lamps,
    consoleLamps: scene.consoleLamps,
    looks: scene.looks,
    obstacles: layout.obstacles.map((o) => o.rect),
    layout,
    dressing: null,
  };
}

function lockedRoom(room: WorldRoom): RoomArt {
  const shell = bareShell(room, "locked");
  return {
    ...EMPTY,
    look: "locked",
    pieces: shell.pieces,
    doors: shell.doors,
    beacons: shell.beacons,
    lamps: [],
  };
}

const arts = new Map<string, RoomArt>();

function artKey(room: WorldRoom, look: RoomLook): string {
  return [
    room.id,
    look,
    room.rect.x,
    room.rect.y,
    room.rect.w,
    room.rect.d,
    room.doorSide,
    room.deskCount,
    room.decorStyle,
  ].join(":");
}

/** The room's art for this viewer (cached by everything that changes it). */
export function roomArt(room: WorldRoom): RoomArt {
  const look = roomLook(room);
  const key = artKey(room, look);
  const hit = arts.get(key);
  if (hit) return hit;
  let art: RoomArt;
  if (look === "special") art = specialRoom(room);
  else if (look === "building") art = buildSite(room);
  else if (look === "locked") art = lockedRoom(room);
  else {
    const layout = roomLayout(room);
    art = layout ? openRoom(room, layout) : lockedRoom(room);
  }
  if (arts.size > 256) arts.clear();
  arts.set(key, art);
  return art;
}
