/**
 * WASD (and arrow keys) mapped to a ground-plane direction relative to the
 * isometric camera (SPEC §9.2): W walks "up-screen", toward the room's back
 * corner, D walks right on screen. Pure so the mapping is unit-testable; the
 * key tracking lives in useWasdInput.ts.
 */
import type { Vec2 } from "@regulus/floor-layout";
import { ISO_YAW_DEG } from "../camera/isoCamera.ts";

export interface DirectionKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

export interface KeyState extends DirectionKeys {
  /** Shift held: run (#223). */
  run: boolean;
}

export const EMPTY_KEYS: Readonly<KeyState> = {
  forward: false,
  back: false,
  left: false,
  right: false,
  run: false,
};

export interface MovementKeyEvent {
  key: string;
  shiftKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** The event targets a text field. */
  editable: boolean;
}

/**
 * The held keys after one keydown (`down`) or keyup. Movement keys and a
 * Shift press count only outside text fields and without Ctrl/Meta/Alt;
 * Shift released anywhere (or any key event without Shift) stops running,
 * so a Shift let go while typing never leaves the avatar running. Returns
 * `keys` itself when nothing changed.
 */
export function nextKeyState(keys: KeyState, event: MovementKeyEvent, down: boolean): KeyState {
  let next = keys;
  if (next.run && !event.shiftKey) next = { ...next, run: false };
  if (event.ctrlKey || event.metaKey || event.altKey || event.editable) return next;
  if (event.key === "Shift") return next.run === down ? next : { ...next, run: down };
  const key = movementKeyFor(event.key);
  if (!key || next[key] === down) return next;
  return { ...next, [key]: down };
}

const KEY_MAP: Readonly<Record<string, keyof DirectionKeys>> = {
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
export function movementKeyFor(key: string): keyof DirectionKeys | null {
  return KEY_MAP[key.toLowerCase()] ?? null;
}

export function anyKeyDown(keys: DirectionKeys): boolean {
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
export function inputVector(keys: DirectionKeys, yawDeg: number = ISO_YAW_DEG): Vec2 {
  const ahead = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  const side = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  if (ahead === 0 && side === 0) return { x: 0, z: 0 };
  const axes = screenAxes(yawDeg);
  const x = axes.forward.x * ahead + axes.right.x * side;
  const z = axes.forward.z * ahead + axes.right.z * side;
  const len = Math.hypot(x, z);
  return { x: x / len, z: z / len };
}
