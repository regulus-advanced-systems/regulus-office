/**
 * Wall picture geometry for the scene (#46). Pure: where the pointer's ray
 * meets a picture wall, where the placement ghost goes and whether it may
 * hang there (the same `checkPicturePlacement` the server runs), and how a
 * corner handle drag resizes a picture. Everything is in the room's frame
 * (metres, origin at its north-west corner) and the wall's frame (`x`
 * along the wall from its `from` end, `y` up from the floor).
 */
import { clampPictureSize, type DecorState } from "@regulus/protocol";
import {
  checkPicturePlacement,
  clampToWall,
  DIRECTION,
  type PictureVerdict,
  pictureWalls,
  type RoomTemplate,
  WALL_THICKNESS,
  type WallRect,
  wallById,
  wallDirection,
  wallLength,
} from "@regulus/room-layout";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A point on a picture wall. */
export interface WallHit {
  wallId: string;
  /** Metres along the wall. */
  x: number;
  /** Metres above the floor. */
  y: number;
  /** Ray distance, for picking the nearest wall. */
  distance: number;
}

export interface PictureDraft extends WallRect {
  wallId: string;
}

/**
 * The nearest picture wall the ray meets from its front (the room side),
 * within the wall's length and height; null when it meets none.
 */
export function wallHit(template: RoomTemplate, origin: Vec3, dir: Vec3): WallHit | null {
  let best: WallHit | null = null;
  for (const wall of pictureWalls(template)) {
    const f = DIRECTION[wall.facing];
    const denom = dir.x * f.x + dir.z * f.z;
    // Only a ray heading into the wall's face counts.
    if (denom >= -1e-9) continue;
    const face = {
      x: wall.from.x + f.x * (WALL_THICKNESS / 2),
      z: wall.from.z + f.z * (WALL_THICKNESS / 2),
    };
    const distance = ((face.x - origin.x) * f.x + (face.z - origin.z) * f.z) / denom;
    if (distance <= 0) continue;
    const px = origin.x + dir.x * distance;
    const pz = origin.z + dir.z * distance;
    const y = origin.y + dir.y * distance;
    const along = wallDirection(wall);
    const x = (px - wall.from.x) * along.x + (pz - wall.from.z) * along.z;
    if (x < 0 || x > wallLength(wall) || y < 0 || y > template.wallHeight) continue;
    if (!best || distance < best.distance) best = { wallId: wall.id, x, y, distance };
  }
  return best;
}

/** The ghost of a `w × h` picture centred on `hit`, kept on the wall's band. */
export function ghostAt(
  template: RoomTemplate,
  hit: Pick<WallHit, "wallId" | "x" | "y">,
  size: { w: number; h: number },
): PictureDraft | null {
  const wall = wallById(template, hit.wallId);
  if (!wall) return null;
  return { wallId: wall.id, ...clampToWall(template, wall, { x: hit.x, y: hit.y, ...size }) };
}

/** The room's pictures in the checker's shape. */
export function placedPictures(decor: Readonly<Record<string, DecorState>> | undefined) {
  return Object.values(decor ?? {})
    .filter((d) => d.kind === "picture")
    .map((d) => ({ id: d.id, wallId: d.wallId, x: d.x, y: d.y, w: d.w, h: d.h }));
}

/** Whether `draft` may hang, against the layout and the other pictures (minus `ignoreId`). */
export function draftVerdict(
  template: RoomTemplate,
  decor: Readonly<Record<string, DecorState>> | undefined,
  draft: PictureDraft,
  ignoreId?: string,
): PictureVerdict {
  return checkPicturePlacement(template, draft.wallId, draft, placedPictures(decor), ignoreId);
}

/**
 * A corner handle dragged to `point` (wall frame): the picture grows or
 * shrinks about its centre, keeping its aspect, within the size limits.
 */
export function resizeToward(
  rect: WallRect,
  point: { x: number; y: number },
): { w: number; h: number } {
  const aspect = rect.w / rect.h;
  const halfW = Math.max(Math.abs(point.x - rect.x), Math.abs(point.y - rect.y) * aspect);
  return clampPictureSize(2 * halfW, (2 * halfW) / aspect);
}

/** One keyboard step bigger (`+1`) or smaller (`-1`), keeping the aspect. */
export function stepSize(size: { w: number; h: number }, dir: 1 | -1): { w: number; h: number } {
  const k = dir > 0 ? 1.1 : 1 / 1.1;
  return clampPictureSize(size.w * k, size.h * k);
}
