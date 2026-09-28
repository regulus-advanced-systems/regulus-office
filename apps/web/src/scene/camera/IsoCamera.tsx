/**
 * Applies `isoCamera.ts` to R3F's default orthographic camera: fixed yaw and
 * pitch, room centred, wheel zoom within limits, re-fit on resize. While
 * `enabled` is false (first-person view, SPEC §9.2) it leaves the camera
 * alone and keeps its zoom factor, so returning to third person restores
 * exactly the previous framing.
 */
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import { OrthographicCamera } from "three";
import {
  CAMERA_FAR,
  CAMERA_NEAR,
  cameraPosition,
  cameraZoom,
  type RoomExtent,
  roomTarget,
  zoomFactorAfterWheel,
} from "./isoCamera.ts";

export function IsoCamera({ room, enabled = true }: { room: RoomExtent; enabled?: boolean }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const factor = useRef(1);
  const active = enabled && camera instanceof OrthographicCamera;

  const applyZoom = useCallback(() => {
    if (!(camera instanceof OrthographicCamera)) return;
    camera.zoom = cameraZoom(size, room, factor.current);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size, room, invalidate]);

  useEffect(() => {
    if (!active) return;
    const target = roomTarget(room);
    const p = cameraPosition(target);
    camera.position.set(p.x, p.y, p.z);
    camera.lookAt(target.x, target.y, target.z);
    camera.near = CAMERA_NEAR;
    camera.far = CAMERA_FAR;
    applyZoom();
  }, [active, camera, room, applyZoom]);

  useEffect(() => {
    if (!active) return;
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      factor.current = zoomFactorAfterWheel(factor.current, e.deltaY);
      applyZoom();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [active, gl, applyZoom]);

  return null;
}
