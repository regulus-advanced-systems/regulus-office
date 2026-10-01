/**
 * The compound camera's controls (SPEC §9.2, #186): the yaw and zoom the
 * player asked for (Q/E, right-drag, wheel). The camera rig eases toward
 * them every frame and writes the yaw it actually shows to `cameraView`,
 * which WASD reads, so "W" always walks up the screen.
 */
import { create } from "zustand";
import {
  clampZoom,
  DEFAULT_YAW_DEG,
  DEFAULT_ZOOM,
  DRAG_YAW_PER_PX,
  WHEEL_ZOOM_PER_PX,
  YAW_STEP_DEG,
} from "../scene/camera/orbit.ts";

const DEG = Math.PI / 180;

export interface CameraStore {
  /** Requested yaw, radians (unwrapped, so easing never spins the long way). */
  yaw: number;
  /** Requested zoom: 0 close third person .. 1 compound overview. */
  zoom: number;
  /** Q (-1) / E (+1): turn by one step, snapped to the step grid. */
  rotateStep: (dir: 1 | -1) => void;
  /** Right-drag by `dx` pixels. */
  drag: (dx: number) => void;
  /** Wheel by `deltaY` pixels (positive zooms out). */
  wheel: (deltaY: number) => void;
  setZoom: (zoom: number) => void;
  reset: () => void;
}

export const useCameraStore = create<CameraStore>()((set, get) => ({
  yaw: DEFAULT_YAW_DEG * DEG,
  zoom: DEFAULT_ZOOM,
  rotateStep: (dir) => {
    const step = YAW_STEP_DEG * DEG;
    const snapped = Math.round(get().yaw / step) * step;
    set({ yaw: snapped + dir * step });
  },
  drag: (dx) => set((s) => ({ yaw: s.yaw - dx * DRAG_YAW_PER_PX })),
  wheel: (deltaY) => set((s) => ({ zoom: clampZoom(s.zoom + deltaY * WHEEL_ZOOM_PER_PX) })),
  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  reset: () => set({ yaw: DEFAULT_YAW_DEG * DEG, zoom: DEFAULT_ZOOM }),
}));

/** What the camera shows this frame (written by the rig; read without subscribing). */
export const cameraView = {
  /** Radians. */
  yaw: DEFAULT_YAW_DEG * DEG,
  zoom: DEFAULT_ZOOM,
  /** Camera distance to its target, metres. */
  distance: 20,
};
