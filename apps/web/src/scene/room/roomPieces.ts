/**
 * Turns a room template's walls into renderable boxes and planes (SPEC §12,
 * research 03 §1, §8): two full back walls, front stub walls with a dark
 * grey cap, window panes on the interior of full walls, and the operation name
 * plate on the exterior face of `nameWallId`. In first-person view
 * (SPEC §9.2) the front stubs are drawn at full height instead, without
 * caps (`frontWalls: "full"`). Pure; `Room.tsx` draws it.
 */
import {
  type CompassDirection,
  DIRECTION,
  type Palette,
  type RoomTemplate,
  WALL_THICKNESS,
  type Wall,
  wallDirection,
  wallLength,
  wallPoint,
} from "@regulus/room-layout";

export type Vec3Tuple = readonly [number, number, number];

/** Height of the dark cap on a stub wall and how far it overhangs each side. */
export const CAP_HEIGHT = 0.08;
export const CAP_OVERHANG = 0.03;
/** Window sill height and pane height on full walls. */
export const WINDOW_SILL = 0.9;
export const WINDOW_HEIGHT = 1.4;
export const WINDOW_FRAME = 0.08;
/** Gap between a wall face and anything pinned onto it (avoids z-fighting). */
export const WALL_SURFACE_GAP = 0.012;

export interface WallPiece {
  id: string;
  height: Wall["height"];
  center: Vec3Tuple;
  size: Vec3Tuple;
  /** Direction the room-facing side looks toward. */
  facing: CompassDirection;
  /** Direction the outside face looks toward (opposite of `facing`). */
  exterior: CompassDirection;
}

export interface CapPiece {
  id: string;
  center: Vec3Tuple;
  size: Vec3Tuple;
}

/** A pane pinned to the interior of a full wall; `yaw` is the plane's rotation.y. */
export interface WindowPiece {
  id: string;
  center: Vec3Tuple;
  width: number;
  height: number;
  yaw: number;
}

export interface NamePlate {
  wallId: string;
  center: Vec3Tuple;
  width: number;
  height: number;
  yaw: number;
}

/** How the front (stub) walls are drawn: dollhouse stubs, or full height in first person. */
export type FrontWallMode = "stub" | "full";

export interface RoomPiecesOptions {
  frontWalls?: FrontWallMode;
}

export interface RoomPieces {
  floor: { center: Vec3Tuple; width: number; depth: number };
  walls: WallPiece[];
  caps: CapPiece[];
  windows: WindowPiece[];
  name: NamePlate | null;
}

export const OPPOSITE: Readonly<Record<CompassDirection, CompassDirection>> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

/** `rotation.y` that turns a PlaneGeometry (front = +z) to face `dir`. */
export function planeYawFacing(dir: { x: number; z: number }): number {
  return Math.atan2(dir.x, dir.z);
}

/** Face index into a BoxGeometry's 6 material groups (+x, -x, +y, -y, +z, -z). */
export function boxFaceIndex(dir: CompassDirection | "up" | "down"): number {
  switch (dir) {
    case "east":
      return 0;
    case "west":
      return 1;
    case "up":
      return 2;
    case "down":
      return 3;
    case "south":
      return 4;
    case "north":
      return 5;
  }
}

export type WallFace = "interior" | "exterior" | "top" | "end";

/** Which surface each of a wall box's 6 faces shows, in BoxGeometry group order. */
export function wallFaces(piece: Pick<WallPiece, "facing" | "exterior">): WallFace[] {
  const faces: WallFace[] = ["end", "end", "top", "end", "end", "end"];
  faces[boxFaceIndex(piece.facing)] = "interior";
  faces[boxFaceIndex(piece.exterior)] = "exterior";
  faces[boxFaceIndex("down")] = "end";
  return faces;
}

export function roomPieces(template: RoomTemplate, options: RoomPiecesOptions = {}): RoomPieces {
  const promoteStubs = options.frontWalls === "full";
  const walls: WallPiece[] = [];
  const caps: CapPiece[] = [];
  const windows: WindowPiece[] = [];
  let name: NamePlate | null = null;

  for (const wall of template.walls) {
    const len = wallLength(wall);
    const dir = wallDirection(wall);
    const alongX = Math.abs(dir.x) > Math.abs(dir.z);
    const height: Wall["height"] = promoteStubs ? "full" : wall.height;
    const h = height === "full" ? template.wallHeight : template.stubHeight;
    const mid = wallPoint(wall, len / 2);
    const size: Vec3Tuple = alongX
      ? [len + WALL_THICKNESS, h, WALL_THICKNESS]
      : [WALL_THICKNESS, h, len + WALL_THICKNESS];
    const exterior = OPPOSITE[wall.facing];
    walls.push({
      id: wall.id,
      height,
      center: [mid.x, h / 2, mid.z],
      size,
      facing: wall.facing,
      exterior,
    });

    if (height === "stub") {
      const o = CAP_OVERHANG * 2;
      caps.push({
        id: `${wall.id}-cap`,
        center: [mid.x, h + CAP_HEIGHT / 2, mid.z],
        size: [size[0] + o, CAP_HEIGHT, size[2] + o],
      });
    }

    const f = DIRECTION[wall.facing];
    for (const [i, opening] of wall.openings.entries()) {
      if (opening.kind !== "window" || height !== "full") continue;
      const p = wallPoint(wall, opening.t + opening.w / 2);
      const off = WALL_THICKNESS / 2 + WALL_SURFACE_GAP;
      windows.push({
        id: `${wall.id}-window-${i}`,
        center: [p.x + f.x * off, WINDOW_SILL + WINDOW_HEIGHT / 2, p.z + f.z * off],
        width: opening.w,
        height: WINDOW_HEIGHT,
        yaw: planeYawFacing(f),
      });
    }

    if (wall.id === template.nameWallId) {
      const e = DIRECTION[exterior];
      const off = WALL_THICKNESS / 2 + WALL_SURFACE_GAP;
      name = {
        wallId: wall.id,
        center: [mid.x + e.x * off, h / 2, mid.z + e.z * off],
        width: len,
        height: h,
        yaw: planeYawFacing(e),
      };
    }
  }

  return {
    floor: {
      center: [template.size.width / 2, 0, template.size.depth / 2],
      width: template.size.width,
      depth: template.size.depth,
    },
    walls,
    caps,
    windows,
    name,
  };
}

export interface RoomColors {
  floor: string;
  /** Interior colour per wall id; north takes `wall`, west takes `wallAlt`. */
  interior: (wallId: string) => string;
  exterior: string;
  cap: string;
  windowFrame: string;
  windowPane: string;
}

/** Palette -> surface colours (SPEC §9.1: palette floor/wall/accent, exterior, cap). */
export function roomColors(palette: Palette): RoomColors {
  return {
    floor: palette.floor,
    interior: (wallId) => (wallId === "west" ? (palette.wallAlt ?? palette.wall) : palette.wall),
    exterior: palette.exterior,
    cap: palette.cap,
    windowFrame: "#FFFFFF",
    windowPane: "#BFE3F5",
  };
}
