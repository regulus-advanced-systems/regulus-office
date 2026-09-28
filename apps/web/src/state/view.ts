/**
 * View mode (SPEC §9.2): third-person isometric by default, first-person on
 * `V` or the HUD button, with a 300 ms crossfade between them. `mode` is the
 * requested mode (what the HUD button reflects); `cameraMode` is what the
 * scene renders and lags `mode` until the crossfade midpoint. The reduced
 * motion setting (SPEC §11) makes the switch an instant cut. Timing maths
 * live in scene/camera/crossfade.ts; `ViewCrossfade.tsx` drives `tick`.
 */
import { create } from "zustand";
import { CROSSFADE_MS, crossfadeDone, crossfadeSwapped } from "../scene/camera/crossfade.ts";
import { selectReducedMotion, useUiStore } from "./ui.ts";

export const VIEW_MODES = ["third_person", "first_person"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export interface ViewFade {
  from: ViewMode;
  to: ViewMode;
  /** Store clock (`deps.now`, `performance.now()` by default). */
  startedAt: number;
  durationMs: number;
}

export interface ViewStore {
  /** Requested mode; the HUD button and pointer lock follow this. */
  mode: ViewMode;
  /** Mode the scene renders; switches at the crossfade midpoint. */
  cameraMode: ViewMode;
  fade: ViewFade | null;
  /** True while the first-person rig holds the pointer lock. */
  pointerLocked: boolean;
  setMode: (mode: ViewMode) => void;
  toggle: () => void;
  /** Advance the crossfade to `now`; the overlay calls this every frame. */
  tick: (now: number) => void;
  setPointerLocked: (locked: boolean) => void;
}

export interface ViewStoreDeps {
  now?: () => number;
  /** Effective reduced-motion flag; defaults to the ui store's. */
  reducedMotion?: () => boolean;
  durationMs?: number;
}

export function oppositeView(mode: ViewMode): ViewMode {
  return mode === "third_person" ? "first_person" : "third_person";
}

const defaultNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function createViewStore(deps: ViewStoreDeps = {}) {
  const now = deps.now ?? defaultNow;
  const reducedMotion = deps.reducedMotion ?? (() => selectReducedMotion(useUiStore.getState()));
  const durationMs = deps.durationMs ?? CROSSFADE_MS;

  return create<ViewStore>()((set, get) => ({
    mode: "third_person",
    cameraMode: "third_person",
    fade: null,
    pointerLocked: false,

    setMode: (mode) => {
      const s = get();
      if (s.mode === mode) return;
      if (reducedMotion()) {
        set({ mode, cameraMode: mode, fade: null });
        return;
      }
      // Toggled back before the midpoint: the camera never left, so just cancel the fade.
      if (s.cameraMode === mode) {
        set({ mode, fade: null });
        return;
      }
      set({ mode, fade: { from: s.cameraMode, to: mode, startedAt: now(), durationMs } });
    },
    toggle: () => get().setMode(oppositeView(get().mode)),

    tick: (t) => {
      const { fade, cameraMode } = get();
      if (!fade) return;
      const elapsed = t - fade.startedAt;
      const patch: Partial<Pick<ViewStore, "cameraMode" | "fade">> = {};
      if (crossfadeSwapped(elapsed, fade.durationMs) && cameraMode !== fade.to) {
        patch.cameraMode = fade.to;
      }
      if (crossfadeDone(elapsed, fade.durationMs)) patch.fade = null;
      if (Object.keys(patch).length > 0) set(patch);
    },

    setPointerLocked: (locked) => {
      if (get().pointerLocked !== locked) set({ pointerLocked: locked });
    },
  }));
}

export const useViewStore = createViewStore();
