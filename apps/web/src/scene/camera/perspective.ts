/**
 * First-person projection maths (SPEC §9.2, issue #144). Pure: no three.js
 * import, so settings code can use the limits without pulling in the scene.
 *
 * The FOV setting is the vertical field of view in degrees. Wider screens see
 * more to the sides ("Hor+"), but the horizontal FOV is capped so that
 * ultra-wide screens (21:9, 32:9) do not stretch the edges of the room; past
 * the cap the vertical FOV shrinks instead. Narrow and portrait screens keep
 * a usable horizontal view the same way from the other side.
 */

/** Default vertical FOV, degrees: about 91 degrees horizontal at 16:9. */
export const DEFAULT_FPV_FOV = 60;
/** Slider range for the vertical FOV setting, degrees. */
export const MIN_FPV_FOV = 50;
export const MAX_FPV_FOV = 75;
/** Horizontal FOV limits, degrees. Beyond MAX the edges visibly stretch. */
export const MAX_HORIZONTAL_FOV = 105;
export const MIN_HORIZONTAL_FOV = 60;
/** Hard bounds on the vertical FOV that is actually rendered, degrees. */
export const MIN_VERTICAL_FOV = 30;
export const MAX_VERTICAL_FOV = 90;

/** Mouse-look sensitivity multiplier (1 = default). */
export const DEFAULT_MOUSE_SENSITIVITY = 1;
export const MIN_MOUSE_SENSITIVITY = 0.25;
export const MAX_MOUSE_SENSITIVITY = 2.5;
/** three's PointerLockControls turns 0.002 x pointerSpeed rad per pixel. */
export const BASE_POINTER_SPEED = 0.8;
/** Pitch limit, degrees up and down from level. No roll, ever. */
export const MAX_PITCH_DEG = 80;

export const FPV_NEAR = 0.1;
export const FPV_FAR = 60;

const DEG = Math.PI / 180;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Horizontal FOV (degrees) for a vertical FOV at an aspect ratio. */
export function horizontalFov(verticalDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((verticalDeg * DEG) / 2) * aspect)) / DEG;
}

/** Vertical FOV (degrees) that yields a horizontal FOV at an aspect ratio. */
export function verticalFovFor(horizontalDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((horizontalDeg * DEG) / 2) / aspect)) / DEG;
}

/** A finite, positive aspect ratio (width / height); 16:9 when unknown. */
export function safeAspect(width: number, height: number): number {
  const a = width / height;
  return Number.isFinite(a) && a > 0 ? a : 16 / 9;
}

/** Clamp a stored FOV setting into the slider range. */
export function clampFovSetting(deg: number): number {
  return Number.isFinite(deg) ? clamp(deg, MIN_FPV_FOV, MAX_FPV_FOV) : DEFAULT_FPV_FOV;
}

/** Clamp a stored mouse sensitivity into the slider range. */
export function clampMouseSensitivity(v: number): number {
  return Number.isFinite(v)
    ? clamp(v, MIN_MOUSE_SENSITIVITY, MAX_MOUSE_SENSITIVITY)
    : DEFAULT_MOUSE_SENSITIVITY;
}

/**
 * The vertical FOV to render for a setting at an aspect ratio: the setting,
 * narrowed so the horizontal FOV stays within [MIN, MAX]_HORIZONTAL_FOV.
 */
export function effectiveVerticalFov(settingDeg: number, aspect: number): number {
  const fov = clampFovSetting(settingDeg);
  const lo = verticalFovFor(MIN_HORIZONTAL_FOV, aspect);
  const hi = verticalFovFor(MAX_HORIZONTAL_FOV, aspect);
  return clamp(clamp(fov, lo, hi), MIN_VERTICAL_FOV, MAX_VERTICAL_FOV);
}

/** The subset of a three.js PerspectiveCamera this module writes. */
export interface PerspectiveLike {
  fov: number;
  aspect: number;
  updateProjectionMatrix(): void;
}

/** Fit a perspective camera to a canvas size and FOV setting; true if it changed. */
export function fitPerspective(
  camera: PerspectiveLike,
  width: number,
  height: number,
  settingDeg: number,
): boolean {
  const aspect = safeAspect(width, height);
  const fov = effectiveVerticalFov(settingDeg, aspect);
  if (camera.aspect === aspect && camera.fov === fov) return false;
  camera.aspect = aspect;
  camera.fov = fov;
  camera.updateProjectionMatrix();
  return true;
}

/** The subset of a three.js OrthographicCamera R3F sizes to the canvas. */
export interface OrthographicLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
  updateProjectionMatrix(): void;
}

/** Fit an orthographic camera's frustum to the canvas in pixels, as R3F does. */
export function fitOrthographic(camera: OrthographicLike, width: number, height: number): void {
  camera.left = width / -2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = height / -2;
  camera.updateProjectionMatrix();
}

/** PointerLockControls polar limits (radians from straight up) for MAX_PITCH_DEG. */
export function polarLimits(maxPitchDeg = MAX_PITCH_DEG): { min: number; max: number } {
  const margin = (90 - clamp(maxPitchDeg, 0, 89)) * DEG;
  return { min: margin, max: Math.PI - margin };
}

/** PointerLockControls.pointerSpeed for a sensitivity setting. */
export function pointerSpeed(sensitivity: number): number {
  return BASE_POINTER_SPEED * clampMouseSensitivity(sensitivity);
}
