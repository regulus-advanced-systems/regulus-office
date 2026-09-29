/**
 * True-isometric camera maths (SPEC §9.2, §12; research 03 §1, §8): an
 * orthographic camera at yaw 45°, pitch 35.264°, fixed yaw, zoom within
 * limits, room centred. Pure functions so the framing is unit-testable; the
 * React side (`IsoCamera.tsx`) only applies the results.
 */

export const ISO_YAW_DEG = 45;
/** atan(1 / sqrt 2): the view direction (1, 1, 1) normalised. */
export const ISO_PITCH_DEG = 35.264;

/** Distance from the look-at target to the camera, metres. Only depth precision depends on it. */
export const CAMERA_DISTANCE = 60;
/**
 * Near/far hug the room (nothing in the largest template, 28 x 18 m, is more
 * than ~16 m from the target along the view axis) so the
 * depth buffer keeps millimetre precision even at 16 bits; the contact-shadow
 * plane sits only centimetres above the floor.
 */
export const CAMERA_NEAR = CAMERA_DISTANCE - 30;
export const CAMERA_FAR = CAMERA_DISTANCE + 30;

/** Fraction of the viewport width the room's projected footprint fills at zoom factor 1. */
export const ROOM_FILL_WIDTH = 0.57;
/** Never let the projected room exceed this fraction of the viewport height at factor 1. */
export const ROOM_FILL_HEIGHT = 0.9;

/** Scroll-zoom multipliers relative to the fitted zoom. */
export const ZOOM_FACTOR_MIN = 0.7;
export const ZOOM_FACTOR_MAX = 2.2;
/**
 * Projected floor width (metres) up to which `ZOOM_FACTOR_MAX` applies as is:
 * the small office (16 x 13 m). Bigger rooms are fitted at fewer pixels per
 * metre, so their zoom-in limit grows by the same ratio and a desk can be
 * brought as close on a large floor as on a small one (#118).
 */
export const ZOOM_REFERENCE_WIDTH = (16 + 13) * Math.SQRT1_2;
/** Wheel sensitivity: zoom factor multiplies by exp(-deltaY * this). */
export const WHEEL_SENSITIVITY = 0.0012;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RoomExtent {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Unit vector from the look-at target toward the camera. */
export function isoDirection(yawDeg = ISO_YAW_DEG, pitchDeg = ISO_PITCH_DEG): Vec3 {
  const yaw = toRad(yawDeg);
  const pitch = toRad(pitchDeg);
  return {
    x: Math.cos(pitch) * Math.sin(yaw),
    y: Math.sin(pitch),
    z: Math.cos(pitch) * Math.cos(yaw),
  };
}

/** Where the camera sits for a given target. */
export function cameraPosition(target: Vec3, distance = CAMERA_DISTANCE): Vec3 {
  const d = isoDirection();
  return {
    x: target.x + d.x * distance,
    y: target.y + d.y * distance,
    z: target.z + d.z * distance,
  };
}

/**
 * Point the camera looks at: the room's floor centre, lifted a little so the
 * back walls do not push the room to the bottom of the frame.
 */
export function roomTarget(room: RoomExtent): Vec3 {
  return { x: room.width / 2, y: room.height * 0.3, z: room.depth / 2 };
}

/**
 * Size of the room's screen-space bounding box in metres (before zoom):
 * the floor diamond's width and the diamond's height plus the back walls.
 */
export function projectedSize(room: RoomExtent): { width: number; height: number } {
  const yaw = toRad(ISO_YAW_DEG);
  const pitch = toRad(ISO_PITCH_DEG);
  const width = room.width * Math.cos(yaw) + room.depth * Math.sin(yaw);
  const floorHeight = (room.width * Math.sin(yaw) + room.depth * Math.cos(yaw)) * Math.sin(pitch);
  return { width, height: floorHeight + room.height * Math.cos(pitch) };
}

/**
 * Orthographic `camera.zoom` (pixels per metre) at zoom factor 1: the room
 * fills `ROOM_FILL_WIDTH` of the viewport width, capped by the height.
 */
export function fitZoom(viewport: Viewport, room: RoomExtent): number {
  const size = projectedSize(room);
  const byWidth = (ROOM_FILL_WIDTH * viewport.width) / size.width;
  const byHeight = (ROOM_FILL_HEIGHT * viewport.height) / size.height;
  return Math.max(1, Math.min(byWidth, byHeight));
}

/** Zoom-in limit for a room: `ZOOM_FACTOR_MAX`, scaled up for rooms wider than the reference. */
export function maxZoomFactor(room?: RoomExtent): number {
  if (!room) return ZOOM_FACTOR_MAX;
  return ZOOM_FACTOR_MAX * Math.max(1, projectedSize(room).width / ZOOM_REFERENCE_WIDTH);
}

export function clampZoomFactor(factor: number, room?: RoomExtent): number {
  if (!Number.isFinite(factor)) return 1;
  return Math.min(maxZoomFactor(room), Math.max(ZOOM_FACTOR_MIN, factor));
}

/** New zoom factor after a wheel event; scrolling up (negative deltaY) zooms in. */
export function zoomFactorAfterWheel(
  factor: number,
  deltaY: number,
  sensitivity = WHEEL_SENSITIVITY,
  room?: RoomExtent,
): number {
  return clampZoomFactor(factor * Math.exp(-deltaY * sensitivity), room);
}

/** Effective `camera.zoom` for a viewport, room and user zoom factor. */
export function cameraZoom(viewport: Viewport, room: RoomExtent, factor: number): number {
  return fitZoom(viewport, room) * clampZoomFactor(factor, room);
}
