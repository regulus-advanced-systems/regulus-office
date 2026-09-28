/**
 * First-person camera rig (SPEC §9.2): a perspective camera at robot eye
 * height over the player pose, pointer-lock mouse look, WASD relative to the
 * camera yaw with collision against the template's nav grid. It mounts as
 * soon as first person is requested (so pointer lock is asked for inside the
 * user's V-press / click activation window) and takes over as the default
 * camera only while `active`, i.e. after the crossfade midpoint. Escape or
 * losing pointer lock returns to third person.
 *
 * Pose ownership: pass `pose` and `onMove` to drive the player store (#15);
 * `onMove` receives the collision-resolved displacement and the camera yaw.
 * Without them the rig keeps a local pose per template, starting at the
 * spawn point, so the view can be exercised before the store lands.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { buildNavGrid, type FloorTemplate } from "@regulus/floor-layout";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Euler, PerspectiveCamera } from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { useUiStore } from "../../state/ui.ts";
import { useViewStore } from "../../state/view.ts";
import { ROBOT_HEIGHT } from "../avatar/index.ts";
import {
  clampDt,
  EYE_HEIGHT_RATIO,
  moveVector,
  NAV_CELL_SIZE,
  stepWithCollision,
  WALK_SPEED,
} from "./fpvMove.ts";
import { exitPointerLock, requestPointerLock } from "./pointerLock.ts";
import { useHeldKeys } from "./useHeldKeys.ts";

/** Robot eye height: ~0.9 x ROBOT_HEIGHT (the head is the top ~quarter). */
export const EYE_HEIGHT = EYE_HEIGHT_RATIO * ROBOT_HEIGHT;
export const FPV_FOV = 70;
export const FPV_NEAR = 0.05;
export const FPV_FAR = 60;
/** Keep the pitch this far off the poles so the view never flips. */
const POLAR_MARGIN = 0.2;
const MOUSE_SPEED = 0.8;

export interface PlayerPose {
  x: number;
  z: number;
  heading: number;
}

export interface FirstPersonRigProps {
  template: FloorTemplate;
  /** Render through this camera (true after the crossfade midpoint). */
  active: boolean;
  /** Player pose from the player store; omit to use the rig's local pose. */
  pose?: PlayerPose;
  /** Called with the collision-resolved step (metres) and the camera yaw. */
  onMove?: (dx: number, dz: number, dt: number, yaw: number) => void;
  eyeHeight?: number;
}

/** Local fallback poses, one per template, so toggling in and out resumes in place. */
const localPoses = new Map<string, PlayerPose>();

function localPose(template: FloorTemplate): PlayerPose {
  let p = localPoses.get(template.id);
  if (!p) {
    p = { ...template.spawn };
    localPoses.set(template.id, p);
  }
  return p;
}

export function FirstPersonRig({
  template,
  active,
  pose,
  onMove,
  eyeHeight = EYE_HEIGHT,
}: FirstPersonRigProps) {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const set = useThree((s) => s.set);
  const invalidate = useThree((s) => s.invalidate);
  const mode = useViewStore((s) => s.mode);

  const camera = useMemo(() => {
    const c = new PerspectiveCamera(FPV_FOV, 1, FPV_NEAR, FPV_FAR);
    c.name = "fpv-camera";
    c.rotation.order = "YXZ";
    return c;
  }, []);
  const controls = useMemo(() => {
    const c = new PointerLockControls(camera);
    c.minPolarAngle = POLAR_MARGIN;
    c.maxPolarAngle = Math.PI - POLAR_MARGIN;
    c.pointerSpeed = MOUSE_SPEED;
    return c;
  }, [camera]);
  const grid = useMemo(() => buildNavGrid(template, { cellSize: NAV_CELL_SIZE }), [template]);
  const euler = useMemo(() => new Euler(0, 0, 0, "YXZ"), []);

  const poseProp = useRef(pose);
  useEffect(() => {
    poseProp.current = pose;
  }, [pose]);
  const currentPose = () => poseProp.current ?? localPose(template);
  const held = useHeldKeys(active);

  // Start where the avatar stands, facing the way it faces.
  useLayoutEffect(() => {
    const p = currentPose();
    camera.position.set(p.x, eyeHeight, p.z);
    camera.rotation.set(0, p.heading, 0);
    // The starting pose is read once on mount by design.
  }, [camera, eyeHeight]);

  // Become the default camera while active; R3F re-fits aspect on swap and resize.
  useLayoutEffect(() => {
    if (!active) return;
    const previous = get().camera;
    set({ camera });
    invalidate();
    return () => {
      set({ camera: previous });
      invalidate();
    };
  }, [active, camera, get, set, invalidate]);

  // Pointer lock: connect, request now, retry on click while unlocked, exit on unlock/Escape.
  useEffect(() => {
    const el = gl.domElement;
    const view = useViewStore.getState;
    controls.connect(el);
    const onLock = () => view().setPointerLocked(true);
    const onUnlock = () => {
      view().setPointerLocked(false);
      view().setMode("third_person");
    };
    const onChange = () => invalidate();
    const onPointerDown = () => {
      if (!controls.isLocked && view().mode === "first_person") requestPointerLock(el);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || controls.isLocked) return;
      if (useUiStore.getState().overlay !== null) return;
      view().setMode("third_person");
    };
    controls.addEventListener("lock", onLock);
    controls.addEventListener("unlock", onUnlock);
    controls.addEventListener("change", onChange);
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    requestPointerLock(el);
    return () => {
      controls.removeEventListener("lock", onLock);
      controls.removeEventListener("unlock", onUnlock);
      controls.removeEventListener("change", onChange);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      controls.disconnect();
      view().setPointerLocked(false);
      exitPointerLock(el.ownerDocument);
    };
  }, [controls, gl, invalidate]);

  // Leaving first person (V or the HUD button) releases the pointer.
  useEffect(() => {
    if (mode === "third_person" && controls.isLocked) exitPointerLock(gl.domElement.ownerDocument);
  }, [mode, controls, gl]);

  useFrame((_, dt) => {
    const yaw = euler.setFromQuaternion(camera.quaternion).y;
    if (active && mode === "first_person") {
      const dir = moveVector(held.current, yaw);
      const p = currentPose();
      if (dir.x !== 0 || dir.z !== 0) {
        const step = WALK_SPEED * clampDt(dt);
        const s = stepWithCollision(grid, p.x, p.z, dir.x * step, dir.z * step);
        if (s.dx !== 0 || s.dz !== 0) {
          if (onMove) onMove(s.dx, s.dz, dt, yaw);
          else localPoses.set(template.id, { x: s.x, z: s.z, heading: yaw });
        }
      } else if (!onMove) {
        localPoses.set(template.id, { x: p.x, z: p.z, heading: yaw });
      }
    }
    const p = currentPose();
    camera.position.set(p.x, eyeHeight, p.z);
  });

  return null;
}
