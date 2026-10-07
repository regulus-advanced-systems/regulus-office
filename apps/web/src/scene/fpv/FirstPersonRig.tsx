/**
 * First-person camera rig (SPEC §9.2): a perspective camera at henchman eye
 * height over the player pose, pointer-lock mouse look, WASD relative to the
 * camera yaw with collision against the template's nav grid. It mounts as
 * soon as first person is requested (so pointer lock is asked for inside the
 * user's V-press / click activation window) and takes over as the default
 * camera only while `active`, i.e. after the crossfade midpoint. Escape or
 * losing pointer lock returns to third person. While a window is open (any
 * modal or HUD overlay) the look is paused instead: the pointer is released
 * for the window, the view and the player hold still, and both resume where
 * they were when it closes (`windowPause.ts`, #282).
 *
 * Pose ownership: pass `getPose` and `onMove` to drive the player store
 * (`playerBinding.ts`); `onMove` runs every active frame with the
 * collision-resolved displacement (zero when standing) and the camera yaw.
 * Without them the rig keeps a local pose per template, starting at the
 * spawn point (the dev harness has no player store). While active the
 * local avatar (`local-human`) is hidden so the camera is not inside it.
 *
 * Projection (#144): the camera is `manual` and fitted here, from the canvas
 * size and the FOV setting (`camera/perspective.ts`), on mount, on resize and
 * when the setting changes. R3F only fits the default camera on a resize, not
 * when the default camera is swapped, so a camera made with aspect 1 stayed
 * at aspect 1 and the view was stretched sideways by the screen's aspect.
 */
import { useFrame, useThree } from "@react-three/fiber";
import type { NavGrid } from "@regulus/room-layout";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  Euler,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  type Quaternion,
} from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { useUiStore } from "../../state/ui.ts";
import { useViewStore } from "../../state/view.ts";
import { anyWindowOpen, useAnyWindowOpen } from "../../state/windows.ts";
import { ROBOT_HEIGHT } from "../avatar/index.ts";
import {
  FPV_FAR,
  FPV_NEAR,
  fitOrthographic,
  fitPerspective,
  pointerSpeed,
  polarLimits,
  safeAspect,
} from "../camera/perspective.ts";
import { selectSpeed } from "../movement/gait.ts";
import { clampDt, EYE_HEIGHT_RATIO, moveVector, stepWithCollision } from "./fpvMove.ts";
import { exitPointerLock, requestPointerLock } from "./pointerLock.ts";
import { useHeldKeys } from "./useHeldKeys.ts";
import {
  escapeLeaves,
  heldView,
  holdUntilSettled,
  holdView,
  LOOK_ACTIVE,
  mayRelockOnClick,
  onPointerLock,
  onPointerUnlock,
  onWindowChange,
  type ViewHold,
} from "./windowPause.ts";

/**
 * Henchman eye height: 0.9 x ROBOT_HEIGHT = 1.44 m (the head is the top
 * quarter), against 0.76 m desks, 0.9 m counters and 3 m walls.
 */
export const EYE_HEIGHT = EYE_HEIGHT_RATIO * ROBOT_HEIGHT;
/** Group name of the local human's avatar (scene/avatars/LocalAvatar.tsx). */
export const LOCAL_AVATAR_NAME = "local-human";

export interface PlayerPose {
  x: number;
  z: number;
  heading: number;
}

export interface FirstPersonRigProps {
  /** Collision grid (the compound's, or one room template's in the dev harnesses). */
  grid: NavGrid;
  /** Where the rig's own pose starts when it has no player store to drive. */
  spawn: PlayerPose;
  /** Identity of `spawn`'s world, keying the rig's own fallback pose. */
  spawnKey: string;
  /** Render through this camera (true after the crossfade midpoint). */
  active: boolean;
  /** Live player pose (read every frame); omit to use the rig's local pose. */
  getPose?: () => PlayerPose;
  /** Every active frame: collision-resolved step in metres (0 when standing) and the camera yaw. */
  onMove?: (dx: number, dz: number, dt: number, yaw: number) => void;
  eyeHeight?: number;
  /** Whether Shift may run right now (#223); default always. */
  canRun?: () => boolean;
}

const always = () => true;

/** Local fallback poses, one per world, so toggling in and out resumes in place. */
const localPoses = new Map<string, PlayerPose>();

function localPose(key: string, spawn: PlayerPose): PlayerPose {
  let p = localPoses.get(key);
  if (!p) {
    p = { ...spawn };
    localPoses.set(key, p);
  }
  return p;
}

export function FirstPersonRig({
  grid,
  spawn,
  spawnKey,
  active,
  getPose,
  onMove,
  eyeHeight = EYE_HEIGHT,
  canRun = always,
}: FirstPersonRigProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const get = useThree((s) => s.get);
  const set = useThree((s) => s.set);
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  const mode = useViewStore((s) => s.mode);
  const fovSetting = useUiStore((s) => s.settings.fpvFov);
  const sensitivity = useUiStore((s) => s.settings.mouseSensitivity);

  const camera = useMemo(() => {
    const { width, height } = get().size;
    const c = new PerspectiveCamera(50, safeAspect(width, height), FPV_NEAR, FPV_FAR);
    c.name = "fpv-camera";
    c.rotation.order = "YXZ";
    // We fit the projection ourselves; R3F must not (see the header).
    (c as PerspectiveCamera & { manual?: boolean }).manual = true;
    return c;
  }, [get]);
  const controls = useMemo(() => {
    const c = new PointerLockControls(camera);
    const polar = polarLimits();
    c.minPolarAngle = polar.min;
    c.maxPolarAngle = polar.max;
    return c;
  }, [camera]);

  // Aspect and FOV follow the canvas size and the setting.
  useLayoutEffect(() => {
    if (fitPerspective(camera, size.width, size.height, fovSetting)) invalidate();
  }, [camera, size.width, size.height, fovSetting, invalidate]);

  useEffect(() => {
    controls.pointerSpeed = pointerSpeed(sensitivity);
  }, [controls, sensitivity]);
  const euler = useMemo(() => new Euler(0, 0, 0, "YXZ"), []);

  const binding = useRef({ getPose, onMove });
  useEffect(() => {
    binding.current = { getPose, onMove };
  }, [getPose, onMove]);
  const currentPose = () => binding.current.getPose?.() ?? localPose(spawnKey, spawn);
  // A window is open: no look, no walking, the cursor is the window's (windowPause.ts).
  const windowOpen = useAnyWindowOpen();
  const pause = useRef(LOOK_ACTIVE);
  /** Where the view pointed when the window opened; kept until the pointer is back and settled. */
  const hold = useRef<ViewHold<Quaternion> | null>(null);
  const held = useHeldKeys(active && !(windowOpen && mode === "first_person"));

  // Start where the avatar stands, facing the way it faces.
  useLayoutEffect(() => {
    const p = currentPose();
    camera.position.set(p.x, eyeHeight, p.z);
    camera.rotation.set(0, p.heading, 0);
    // The first lock can report the cursor's trip to the lock point as a turn: hold through it.
    hold.current = holdView(camera.quaternion.clone());
    // The starting pose is read once on mount by design.
  }, [camera, eyeHeight]);

  // Become the default camera while active; R3F re-fits aspect on swap and resize.
  useLayoutEffect(() => {
    if (!active) return;
    const previous = get().camera;
    set({ camera });
    invalidate();
    return () => {
      // R3F only sized the default camera while it was current; a resize in
      // first person left the iso camera's frustum at the old canvas size.
      const { width, height } = get().size;
      const manual = (previous as { manual?: boolean }).manual === true;
      if (previous instanceof OrthographicCamera && !manual)
        fitOrthographic(previous, width, height);
      set({ camera: previous });
      invalidate();
    };
  }, [active, camera, get, set, invalidate]);

  // Pointer lock: connect, request now, retry on click while unlocked, exit on unlock/Escape.
  useEffect(() => {
    const el = gl.domElement;
    const view = useViewStore.getState;
    controls.connect(el);
    const onLock = () => {
      const next = onPointerLock(pause.current);
      pause.current = next.state;
      view().setPointerLocked(true);
      // Granted under a window (asked for just before it opened): the window keeps the cursor.
      if (next.pointer === "release") exitPointerLock(el.ownerDocument);
      else hold.current = holdUntilSettled(hold.current, performance.now());
    };
    const onUnlock = () => {
      view().setPointerLocked(false);
      // Our own release for a window keeps first person; the human's Escape leaves it.
      const next = onPointerUnlock(pause.current);
      pause.current = next.state;
      if (next.leave) view().setMode("third_person");
    };
    const onChange = () => invalidate();
    const onPointerDown = () => {
      if (mayRelockOnClick(pause.current, view().mode === "first_person", controls.isLocked))
        requestPointerLock(el);
    };
    // Browsers exit pointer lock on Escape themselves (which lands in onUnlock);
    // handling the key too covers engines that deliver it without unlocking.
    // Capture phase: read "is a window open" before that window's own Escape closes it.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !escapeLeaves(pause.current, anyWindowOpen())) return;
      view().setMode("third_person");
    };
    // While the view is held (a window is open, or the pointer was only just locked) the
    // locked pointer's movement never reaches the look controls. Capture phase on the
    // document, ahead of their listener; only our own locked pointer, so a window's own
    // mouse handling is untouched.
    const doc = el.ownerDocument;
    const onMouseMove = (e: MouseEvent) => {
      if (doc.pointerLockElement !== el) return;
      if (heldView(hold.current, performance.now())) e.stopImmediatePropagation();
    };
    doc.addEventListener("mousemove", onMouseMove, true);
    controls.addEventListener("lock", onLock);
    controls.addEventListener("unlock", onUnlock);
    controls.addEventListener("change", onChange);
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    // Mounted with a window already open: it keeps the pointer until it closes.
    if (!anyWindowOpen()) requestPointerLock(el);
    return () => {
      doc.removeEventListener("mousemove", onMouseMove, true);
      controls.removeEventListener("lock", onLock);
      controls.removeEventListener("unlock", onUnlock);
      controls.removeEventListener("change", onChange);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
      controls.disconnect();
      pause.current = LOOK_ACTIVE;
      hold.current = null;
      view().setPointerLocked(false);
      view().setLookPaused(false);
      exitPointerLock(el.ownerDocument);
    };
  }, [controls, gl, invalidate]);

  // A window opened or closed: free the pointer for it, take it back afterwards.
  // The camera is not touched, so the view resumes facing exactly where it was.
  useEffect(() => {
    const el = gl.domElement;
    const next = onWindowChange(pause.current, {
      windowOpen,
      firstPerson: mode === "first_person",
      // The document knows a moment before the controls hear of it.
      locked: controls.isLocked || el.ownerDocument.pointerLockElement === el,
    });
    if (next.state.paused && !pause.current.paused)
      hold.current = holdView(camera.quaternion.clone());
    pause.current = next.state;
    useViewStore.getState().setLookPaused(next.state.paused);
    if (next.pointer === "release") exitPointerLock(el.ownerDocument);
    // No user gesture is needed after a release by script; if the browser still
    // refuses, the HUD hint says to click the scene, which locks again.
    else if (next.pointer === "relock") requestPointerLock(el);
  }, [windowOpen, mode, controls, gl, camera]);

  // Hide our own avatar while looking out of its eyes.
  useEffect(() => {
    if (!active) return;
    const hidden: Object3D[] = [];
    const hide = () => {
      const avatar = scene.getObjectByName(LOCAL_AVATAR_NAME);
      if (avatar?.visible) {
        avatar.visible = false;
        hidden.push(avatar);
      }
    };
    hide();
    // The avatar may mount after the rig (Suspense on the GLB).
    const timer = setInterval(hide, 250);
    return () => {
      clearInterval(timer);
      for (const o of hidden) o.visible = true;
    };
  }, [active, scene]);

  // Leaving first person (V or the HUD button) releases the pointer.
  useEffect(() => {
    if (mode === "third_person" && controls.isLocked) exitPointerLock(gl.domElement.ownerDocument);
  }, [mode, controls, gl]);

  useFrame((_, dt) => {
    // Under a window, and until the pointer has settled after it: the view as it was.
    const kept = heldView(hold.current, performance.now());
    if (kept) camera.quaternion.copy(kept);
    else hold.current = null;
    const yaw = euler.setFromQuaternion(camera.quaternion).y;
    if (active && mode === "first_person" && !pause.current.paused) {
      const dir = moveVector(held.current, yaw);
      const p = currentPose();
      const frame = clampDt(dt);
      const shift = held.current.has("run") && canRun();
      const step = selectSpeed({ shift, pathRun: false }) * frame;
      const s = stepWithCollision(grid, p.x, p.z, dir.x * step, dir.z * step);
      const move = binding.current.onMove;
      if (move) move(s.dx, s.dz, frame, yaw);
      else localPoses.set(spawnKey, { x: s.x, z: s.z, heading: yaw });
    }
    const p = currentPose();
    camera.position.set(p.x, eyeHeight, p.z);
  });

  return null;
}
