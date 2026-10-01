/**
 * The compound camera (SPEC §9.2, #186): a perspective camera at a 3/4
 * overhead angle (pitch about 50°) that follows the player, rotates about
 * them (Z/C in 45° steps, or right-drag) and zooms with the wheel from a
 * close third-person view down to an overview of the whole compound. Pure
 * maths, so the framing is unit-testable; `CompoundCamera.tsx` applies it.
 *
 * Yaw convention (shared with movement/wasd.ts `screenAxes`): the camera
 * sits at `+sin(yaw), +cos(yaw)` from its target on the ground plane and
 * looks back at it, so yaw 0 looks north and yaw 45° is the old iso view.
 */

export const ORBIT_FOV_DEG = 40;
/** The 3/4 overhead pitch over most of the zoom range. */
export const ORBIT_PITCH_DEG = 50;
/** Pitch at the closest zoom: lower, behind the player's shoulder. */
export const CLOSE_PITCH_DEG = 30;
/** Camera distance to its target at the closest zoom, metres. */
export const MIN_DISTANCE = 5;
/** Never zoom out less far than this, even in a tiny compound. */
export const MIN_OVERVIEW_DISTANCE = 45;
/** Zoom before the compound's size is known (the rig then frames a room: `defaultZoom`). */
export const DEFAULT_ZOOM = 0.5;
/**
 * The first view, metres from the player (#190): a room-level framing, the
 * whole of a large room and its door in view; the wheel zooms in from there.
 */
export const DEFAULT_DISTANCE = 30;
/** The default framing never reaches the zoom where the view starts drifting off the player. */
const DEFAULT_ZOOM_MAX = 0.58;
/** Z/C turn this much per press. */
export const YAW_STEP_DEG = 45;
/** Start at the old iso yaw, so the first view matches what people know. */
export const DEFAULT_YAW_DEG = 45;
/** Right-drag: radians of yaw per pixel. */
export const DRAG_YAW_PER_PX = 0.006;
/** Wheel: zoom units per wheel delta pixel. */
export const WHEEL_ZOOM_PER_PX = 0.0008;
/** Height above the player's feet the camera looks at, metres. */
export const TARGET_HEIGHT = 1.1;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, t: number) => {
  const u = clamp01((t - a) / (b - a));
  return u * u * (3 - 2 * u);
};

/** Distance to the target that frames a compound of `extent` metres (its larger side). */
export function overviewDistance(extent: number, fovDeg = ORBIT_FOV_DEG): number {
  const half = Math.tan((fovDeg * DEG) / 2);
  return Math.max(MIN_OVERVIEW_DISTANCE, (extent * 0.42) / half);
}

/** Camera distance for a zoom in [0, 1]: 0 is close third person, 1 the compound overview. */
export function zoomDistance(zoom: number, maxDistance: number): number {
  const z = clamp01(zoom);
  return Math.exp(Math.log(MIN_DISTANCE) + (Math.log(maxDistance) - Math.log(MIN_DISTANCE)) * z);
}

/** Pitch for a zoom: 50° over most of the range, easing lower in the closest quarter. */
export function zoomPitchDeg(zoom: number): number {
  const t = smooth(0, 0.3, zoom);
  return CLOSE_PITCH_DEG + (ORBIT_PITCH_DEG - CLOSE_PITCH_DEG) * t;
}

/** How far the look-at point has moved from the player to the compound's centre (0..1). */
export function overviewBlend(zoom: number): number {
  return smooth(0.6, 1, zoom);
}

/** The zoom that puts the camera `distance` metres away, for a compound of `extent` metres. */
export function zoomForDistance(distance: number, extent: number): number {
  const max = overviewDistance(extent);
  return clamp01(Math.log(distance / MIN_DISTANCE) / Math.log(max / MIN_DISTANCE));
}

/** The starting zoom: a room-level framing (DEFAULT_DISTANCE), short of the overview's drift. */
export function defaultZoom(extent: number): number {
  return Math.min(DEFAULT_ZOOM_MAX, zoomForDistance(DEFAULT_DISTANCE, extent));
}

export function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? clamp01(zoom) : DEFAULT_ZOOM;
}

/** Unit vector from the target toward the camera. */
export function orbitDirection(yaw: number, pitchDeg: number): Vec3 {
  const p = pitchDeg * DEG;
  return { x: Math.cos(p) * Math.sin(yaw), y: Math.sin(p), z: Math.cos(p) * Math.cos(yaw) };
}

export interface OrbitInput {
  yaw: number;
  zoom: number;
  /** The player's feet. */
  player: { x: number; z: number };
  /** Centre of the compound (metres) and its larger side. */
  centre: { x: number; z: number };
  extent: number;
}

export interface OrbitPose {
  position: Vec3;
  target: Vec3;
  distance: number;
  pitchDeg: number;
}

/** Where the camera is and what it looks at. */
export function orbitPose(input: OrbitInput): OrbitPose {
  const max = overviewDistance(input.extent);
  const distance = zoomDistance(input.zoom, max);
  const pitchDeg = zoomPitchDeg(input.zoom);
  const b = overviewBlend(input.zoom);
  const target = {
    x: input.player.x + (input.centre.x - input.player.x) * b,
    y: TARGET_HEIGHT * (1 - b),
    z: input.player.z + (input.centre.z - input.player.z) * b,
  };
  const d = orbitDirection(input.yaw, pitchDeg);
  return {
    position: {
      x: target.x + d.x * distance,
      y: target.y + d.y * distance,
      z: target.z + d.z * distance,
    },
    target,
    distance,
    pitchDeg,
  };
}

/** Near and far planes that keep depth precision at every zoom. */
export function clipPlanes(distance: number, extent: number): { near: number; far: number } {
  return { near: Math.max(0.2, distance * 0.03), far: distance * 2 + extent * 1.5 + 50 };
}

/** Wrap an angle into [-π, π). */
export function wrapYaw(yaw: number): number {
  const two = Math.PI * 2;
  let y = (yaw + Math.PI) % two;
  if (y < 0) y += two;
  return y - Math.PI;
}

/** Approach `target` from `current` exponentially, along the shorter way round. */
export function dampYaw(current: number, target: number, dt: number, rate = 10): number {
  const delta = wrapYaw(target - current);
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  return Math.abs(delta) < 1e-4 ? target : current + delta * k;
}

export function damp(current: number, target: number, dt: number, rate = 10): number {
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  return Math.abs(target - current) < 1e-5 ? target : current + (target - current) * k;
}
