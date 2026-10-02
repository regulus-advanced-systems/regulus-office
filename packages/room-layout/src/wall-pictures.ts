/**
 * Where a wall picture may hang (#46, SPEC §9.4), shared by the server (which
 * decides) and the web client (whose placement ghost shows the verdict).
 *
 * A picture hangs on a full wall of the room, in that wall's frame: `x` is
 * the distance along the wall from its `from` end to the picture's centre,
 * `y` the centre's height above the floor, `w × h` its size, metres (the
 * `decor` row, SPEC §5). It must stay on the wall (clear of its ends, above
 * `MIN_BOTTOM`, below the top), and clear of everything else hung there or
 * standing in front of it: wall anchors (issue and PR boards, the queue
 * clipboard, the whiteboard, the usage screen, the gong, the TV and the
 * generated picture frames), wall decor, doors and windows, tall furniture
 * against the wall, and the other pictures.
 */
import { WALL_PICTURE_LIMITS } from "@regulus/protocol";
import { DIRECTION } from "./geometry.ts";
import { rectSpanOnWall, WALL_THICKNESS, wallById, wallLength } from "./query.ts";
import type { ObstacleKind, RoomTemplate, Wall } from "./types.ts";

/** A picture (or anything else) on a wall, in the wall's frame. */
export interface WallRect {
  /** Centre, metres along the wall from its `from` end. */
  x: number;
  /** Centre, metres above the floor. */
  y: number;
  w: number;
  h: number;
}

export interface PlacedPicture extends WallRect {
  id: string;
  wallId: string;
}

/** Lowest a picture's bottom edge may hang, metres (above desks, couches and cabinets). */
export const PICTURE_MIN_BOTTOM = 0.9;
/** Clearance kept below the top of the wall and from its ends, metres. */
export const PICTURE_TOP_MARGIN = 0.12;
export const PICTURE_END_MARGIN = 0.15;
/** Gap kept around everything else on the wall, metres. */
export const PICTURE_GAP = 0.05;
/** Furniture closer to the wall line than this counts as standing against it, metres. */
const AGAINST_WALL = 0.6;

/**
 * How tall furniture that stands against a wall is, metres (the art kit's
 * heights, rounded up): a picture above it must clear it. Kinds not listed
 * are lower than `PICTURE_MIN_BOTTOM`.
 */
export const TALL_FURNITURE: Partial<Record<ObstacleKind, number>> = {
  bookshelf: 2.1,
  fridge: 2,
  plant: 1.95,
  floor_lamp: 1.9,
  jukebox: 1.8,
  coffee_machine: 1.4,
  water_cooler: 1.35,
  planter: 1.25,
  cabinet: 1.2,
  counter: 1.1,
};

export type PictureProblem =
  | "no_wall"
  | "bad_size"
  | "off_wall"
  | "overlaps_opening"
  | "overlaps_anchor"
  | "overlaps_decor"
  | "overlaps_furniture"
  | "overlaps_picture";

export type PictureVerdict = { ok: true } | { ok: false; problem: PictureProblem; with?: string };

/** Human wording for a refusal. */
export const PICTURE_PROBLEM_TEXT: Readonly<Record<PictureProblem, string>> = {
  no_wall: "Pictures hang on the room's full walls.",
  bad_size: "That size is out of range.",
  off_wall: "It does not fit on the wall there.",
  overlaps_opening: "It would cover a door or window.",
  overlaps_anchor: "It would cover a board or screen.",
  overlaps_decor: "It would cover the wall decor.",
  overlaps_furniture: "Furniture stands in front of that spot.",
  overlaps_picture: "Another picture hangs there.",
};

/** Walls that take pictures: full walls whose whole length is not a door. */
export function pictureWalls(template: RoomTemplate): Wall[] {
  return template.walls.filter((wall) => {
    if (wall.height !== "full") return false;
    const len = wallLength(wall);
    const open = wall.openings.reduce((sum, o) => sum + o.w, 0);
    return len - open >= WALL_PICTURE_LIMITS.minSize + 2 * PICTURE_END_MARGIN;
  });
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const box = (r: WallRect): Box => ({
  x0: r.x - r.w / 2,
  x1: r.x + r.w / 2,
  y0: r.y - r.h / 2,
  y1: r.y + r.h / 2,
});

/** Overlap with `gap` clearance; touching at exactly `gap` is fine. */
function hits(a: Box, b: Box, gap: number): boolean {
  const eps = 1e-6;
  return (
    a.x0 < b.x1 + gap - eps &&
    b.x0 < a.x1 + gap - eps &&
    a.y0 < b.y1 + gap - eps &&
    b.y0 < a.y1 + gap - eps
  );
}

/** Furniture standing against `wall`, as boxes in the wall's frame (floor to its height). */
function furnitureOn(template: RoomTemplate, wall: Wall): { id: string; box: Box }[] {
  const f = DIRECTION[wall.facing];
  const out: { id: string; box: Box }[] = [];
  for (const o of template.obstacles) {
    const height = TALL_FURNITURE[o.kind];
    if (height === undefined) continue;
    // Distance from the wall's face to the obstacle's nearest edge, along the facing.
    const face = WALL_THICKNESS / 2;
    const near =
      f.x !== 0
        ? f.x > 0
          ? o.rect.x - wall.from.x
          : wall.from.x - (o.rect.x + o.rect.w)
        : f.z > 0
          ? o.rect.z - wall.from.z
          : wall.from.z - (o.rect.z + o.rect.d);
    if (near < -face || near > AGAINST_WALL) continue;
    const span = rectSpanOnWall(wall, o.rect);
    out.push({ id: o.id, box: { x0: span.start, x1: span.end, y0: 0, y1: height } });
  }
  return out;
}

/**
 * Whether `rect` may hang on `wallId`. `pictures` are the room's other
 * pictures (the one being moved is left out by id, `ignoreId`).
 */
export function checkPicturePlacement(
  template: RoomTemplate,
  wallId: string,
  rect: WallRect,
  pictures: readonly PlacedPicture[] = [],
  ignoreId?: string,
): PictureVerdict {
  const wall = wallById(template, wallId);
  if (!wall || !pictureWalls(template).includes(wall)) return { ok: false, problem: "no_wall" };
  const { minSize, maxSize } = WALL_PICTURE_LIMITS;
  const sized = (v: number) => Number.isFinite(v) && v >= minSize - 1e-6 && v <= maxSize + 1e-6;
  if (!sized(rect.w) || !sized(rect.h) || !Number.isFinite(rect.x) || !Number.isFinite(rect.y))
    return { ok: false, problem: "bad_size" };
  const b = box(rect);
  const len = wallLength(wall);
  if (
    b.x0 < PICTURE_END_MARGIN - 1e-6 ||
    b.x1 > len - PICTURE_END_MARGIN + 1e-6 ||
    b.y0 < PICTURE_MIN_BOTTOM - 1e-6 ||
    b.y1 > template.wallHeight - PICTURE_TOP_MARGIN + 1e-6
  )
    return { ok: false, problem: "off_wall" };
  for (const o of wall.openings) {
    if (hits(b, { x0: o.t, x1: o.t + o.w, y0: 0, y1: template.wallHeight }, PICTURE_GAP))
      return { ok: false, problem: "overlaps_opening" };
  }
  if (template.elevator.wallId === wall.id) {
    const span = rectSpanOnWall(wall, template.elevator.rect);
    if (hits(b, { x0: span.start, x1: span.end, y0: 0, y1: template.wallHeight }, PICTURE_GAP))
      return { ok: false, problem: "overlaps_opening" };
  }
  for (const a of template.wallAnchors) {
    if (a.wallId === wall.id && hits(b, box({ x: a.t, y: a.y, w: a.w, h: a.h }), PICTURE_GAP))
      return { ok: false, problem: "overlaps_anchor", with: a.id };
  }
  for (const d of template.wallDecor) {
    if (d.wallId === wall.id && hits(b, box({ x: d.t, y: d.y, w: d.w, h: d.h }), PICTURE_GAP))
      return { ok: false, problem: "overlaps_decor", with: d.id };
  }
  for (const f of furnitureOn(template, wall)) {
    if (hits(b, f.box, PICTURE_GAP))
      return { ok: false, problem: "overlaps_furniture", with: f.id };
  }
  for (const p of pictures) {
    if (p.id === ignoreId || p.wallId !== wall.id) continue;
    if (hits(b, box(p), PICTURE_GAP)) return { ok: false, problem: "overlaps_picture", with: p.id };
  }
  return { ok: true };
}

/** Keep a picture's centre where it fits the wall's ends, floor band and top, if it can. */
export function clampToWall(template: RoomTemplate, wall: Wall, rect: WallRect): WallRect {
  const len = wallLength(wall);
  const lo = (min: number, max: number, v: number) =>
    min > max ? (min + max) / 2 : Math.min(max, Math.max(min, v));
  return {
    ...rect,
    x: lo(PICTURE_END_MARGIN + rect.w / 2, len - PICTURE_END_MARGIN - rect.w / 2, rect.x),
    y: lo(
      PICTURE_MIN_BOTTOM + rect.h / 2,
      template.wallHeight - PICTURE_TOP_MARGIN - rect.h / 2,
      rect.y,
    ),
  };
}
