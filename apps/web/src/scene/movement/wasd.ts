/**
 * WASD (and arrow keys) mapped to a ground-plane direction relative to the
 * isometric camera (SPEC §9.2): W walks "up-screen", toward the room's back
 * corner, D walks right on screen. Pure so the mapping is unit-testable; the
 * key tracking lives in useWasdInput.ts.
 */
import type { Vec2 } from "@regulus/floor-layout";
import { ISO_YAW_DEG } from "../camera/isoCamera.ts";

export interface KeyState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

export const EMPTY_KEYS: Readonly<KeyState> = {
  forward: false,
  back: false,
  left: false,
  right: false,
};

const KEY_MAP: Readonly<Record<string, keyof KeyState>> = {
  w: "forward",
  arrowup: "forward",
  s: "back",
  arrowdown: "back",
  a: "left",
  arrowleft: "left",
  d: "right",
  arrowright: "right",
};

/** Which movement key a `KeyboardEvent.key` is, or null for any other key. */
export function movementKeyFor(key: string): keyof KeyState | null {
  return KEY_MAP[key.toLowerCase()] ?? null;
}

export function anyKeyDown(keys: KeyState): boolean {
  return keys.forward || keys.back || keys.left || keys.right;
}

/**
 * Ground-plane unit vectors for "up-screen" and "right on screen" for a
 * camera at `yawDeg` (the camera sits at +sin(yaw), +cos(yaw) from its target
 * and looks back at it, so up-screen is the opposite direction).
 */
export function screenAxes(yawDeg: number = ISO_YAW_DEG): { forward: Vec2; right: Vec2 } {
  const yaw = (yawDeg * Math.PI) / 180;
  const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  // right = forward x up for a y-up right-handed frame.
  const right = { x: -forward.z, z: forward.x };
  return { forward, right };
}

/** Ground direction for the pressed keys, unit length or zero when idle/cancelled. */
export function inputVector(keys: KeyState, yawDeg: number = ISO_YAW_DEG): Vec2 {
  const ahead = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  const side = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  if (ahead === 0 && side === 0) return { x: 0, z: 0 };
  const axes = screenAxes(yawDeg);
  const x = axes.forward.x * ahead + axes.right.x * side;
  const z = axes.forward.z * ahead + axes.right.z * side;
  const len = Math.hypot(x, z);
  return { x: x / len, z: z / len };
}
