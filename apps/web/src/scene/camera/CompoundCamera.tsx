/**
 * Applies `orbit.ts` to R3F's default perspective camera (SPEC §9.2, #186):
 * follows the player at a 3/4 overhead angle, eases toward the yaw and zoom
 * in the camera store, and binds the controls: Z and C turn by 45°
 * (#190; E only interacts), a right-drag turns freely, the wheel zooms
 * from close third person out to the compound overview. While `enabled` is
 * false (first person) it leaves the camera alone; the first-person rig
 * swaps in its own camera and gives this one back when it is done.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { PerspectiveCamera } from "three";
import { cameraView, useCameraStore } from "../../state/camera.ts";
import { usePlayerStore } from "../../state/player.ts";
import { useUiStore } from "../../state/ui.ts";
import type { HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import { clipPlanes, damp, dampYaw, defaultZoom, ORBIT_FOV_DEG, orbitPose } from "./orbit.ts";

export interface CompoundCameraProps {
  /** Centre of the compound and its larger side, metres (the overview frames it). */
  centre: { x: number; z: number };
  extent: number;
  enabled?: boolean;
}

/** Pixels a right-button press may travel before it counts as a drag (not a context click). */
const DRAG_SLOP_PX = 4;

export function CompoundCamera({ centre, extent, enabled = true }: CompoundCameraProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const shown = useRef({
    yaw: useCameraStore.getState().yaw,
    zoom: useCameraStore.getState().zoom,
  });

  // Start at a room-level framing for this compound's size, until a zoom is chosen (#190).
  useEffect(() => {
    const store = useCameraStore.getState();
    store.setDefaultZoom(defaultZoom(extent));
    if (!store.zoomChosen) shown.current.zoom = useCameraStore.getState().zoom;
  }, [extent]);

  // The default camera is ours to fit (R3F does it on resize; the FPV swap needs it again).
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || !enabled) return;
    camera.fov = ORBIT_FOV_DEG;
    camera.aspect = size.width / Math.max(1, size.height);
    camera.updateProjectionMatrix();
  }, [camera, size, enabled]);

  // Z turns left, C right (#190: E only interacts now).
  useHotkeyEvents((detail: HotkeyEventDetail) => {
    if (!enabled) return;
    if (detail.id === "turnLeft") useCameraStore.getState().rotateStep(-1);
    if (detail.id === "turnRight") useCameraStore.getState().rotateStep(1);
  });

  // Wheel zoom and right-drag rotation on the canvas.
  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;
    const drag = { active: false, x: 0, moved: 0 };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      useCameraStore.getState().wheel(e.deltaY);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 2) return;
      drag.active = true;
      drag.x = e.clientX;
      drag.moved = 0;
    };
    const onMove = (e: PointerEvent) => {
      if (!drag.active) return;
      const dx = e.clientX - drag.x;
      drag.x = e.clientX;
      drag.moved += Math.abs(dx);
      if (drag.moved > DRAG_SLOP_PX) useCameraStore.getState().drag(dx);
    };
    const onUp = (e: PointerEvent) => {
      if (e.button === 2) drag.active = false;
    };
    // A right-drag must not open the browser's menu over the scene.
    const onMenu = (e: MouseEvent) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("contextmenu", onMenu);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("contextmenu", onMenu);
    };
  }, [gl, enabled]);

  useFrame((_, delta) => {
    if (!enabled || !(camera instanceof PerspectiveCamera)) return;
    const dt = Math.min(delta, 0.1);
    const want = useCameraStore.getState();
    const reduced = useUiStore.getState().settings.reducedMotion === true;
    shown.current.yaw = reduced ? want.yaw : dampYaw(shown.current.yaw, want.yaw, dt, 9);
    shown.current.zoom = reduced ? want.zoom : damp(shown.current.zoom, want.zoom, dt, 8);
    const player = usePlayerStore.getState();
    const pose = orbitPose({
      yaw: shown.current.yaw,
      zoom: shown.current.zoom,
      player: { x: player.x, z: player.z },
      centre,
      extent,
    });
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    const clip = clipPlanes(pose.distance, extent);
    if (camera.near !== clip.near || camera.far !== clip.far) {
      camera.near = clip.near;
      camera.far = clip.far;
      camera.updateProjectionMatrix();
    }
    cameraView.yaw = shown.current.yaw;
    cameraView.zoom = shown.current.zoom;
    cameraView.distance = pose.distance;
  });

  return null;
}
