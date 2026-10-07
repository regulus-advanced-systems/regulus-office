/**
 * Riding the lift (SPEC §14 D26; #269). The lift's panel lists the levels
 * this viewer is shown; picking one plays a short ride and changes level
 * half way through it, with `travelToLevel` (travel.ts), which stays the one
 * function that changes level. The ride is only a transition on screen:
 *
 * - `doors`: the lift's doors close over the view, the indicator runs to the
 *   new level, the doors open on its landing;
 * - `fade`: a quick dip to dark, for the low graphics preset;
 * - `cut`: no transition at all, for reduced motion: the level changes at once.
 */
import { create } from "zustand";
import type { Quality } from "../scene/compound/quality.ts";
import { useBuildingStore } from "./building.ts";
import { isKnownLevel, useLevelStore } from "./level.ts";
import { usePlayerStore } from "./player.ts";
import { travelToLevel } from "./travel.ts";

/** The UI overlay id of the lift's panel. */
export const LIFT_OVERLAY = "lift";

export type RideStyle = "doors" | "fade" | "cut";

/** How long each ride takes on screen, ms. */
export const RIDE_MS: Readonly<Record<RideStyle, number>> = { doors: 1500, fade: 500, cut: 0 };

/** Reduced motion cuts; the low preset fades; otherwise the doors close and open. */
export function rideStyle(reducedMotion: boolean, quality: Quality): RideStyle {
  if (reducedMotion) return "cut";
  return quality === "low" ? "fade" : "doors";
}

export type RidePhase = "closing" | "moving" | "opening" | "done";

/**
 * Where a ride is `elapsed` ms in: the doors close for the first third, the
 * lift moves (the level changes in the middle of this), and they open for
 * the last third.
 */
export function ridePhase(elapsedMs: number, durationMs: number): RidePhase {
  if (durationMs <= 0 || elapsedMs >= durationMs) return "done";
  const t = elapsedMs / durationMs;
  return t < 1 / 3 ? "closing" : t < 2 / 3 ? "moving" : "opening";
}

export interface LiftRide {
  from: string;
  to: string;
  style: Exclude<RideStyle, "cut">;
  durationMs: number;
  /** The level has changed: the indicator shows the destination from here on. */
  arrived: boolean;
}

export interface LiftStore {
  ride: LiftRide | null;
  /** The level the last ride ended on, for the arrival announcement. */
  arrivedAt: string | null;
  set: (patch: Partial<Pick<LiftStore, "ride" | "arrivedAt">>) => void;
}

export const useLiftStore = create<LiftStore>()((set) => ({
  ride: null,
  arrivedAt: null,
  set: (patch) => set(patch),
}));

export type RideResult = "riding" | "arrived" | "here" | "unknown" | "busy";

export interface RideOptions {
  style: RideStyle;
  /** Timers, injectable for tests. */
  schedule?: (fn: () => void, ms: number) => unknown;
  /** The level could not be reached after all (it went away during the ride). */
  onLost?: () => void;
}

/**
 * Ride the lift to `levelId`. `here` when it is the level the player is on,
 * `unknown` when it is not a level this viewer is shown, `busy` during a ride.
 */
export function rideLift(levelId: string, options: RideOptions): RideResult {
  const store = useLiftStore.getState();
  if (store.ride) return "busy";
  const from = useLevelStore.getState().levelId;
  if (levelId === from) return "here";
  if (!usePlayerStore.getState().spawned) return "unknown";
  if (!isKnownLevel(useBuildingStore.getState().state, levelId)) return "unknown";
  if (options.style === "cut") {
    if (!travelToLevel(levelId)) return "unknown";
    store.set({ arrivedAt: levelId });
    return "arrived";
  }
  const durationMs = RIDE_MS[options.style];
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  store.set({
    ride: { from, to: levelId, style: options.style, durationMs, arrived: false },
    arrivedAt: null,
  });
  schedule(() => {
    const ride = useLiftStore.getState().ride;
    if (!ride) return;
    // If the level went away meanwhile, the doors open again where the ride began.
    if (travelToLevel(levelId)) useLiftStore.getState().set({ ride: { ...ride, arrived: true } });
    else options.onLost?.();
  }, durationMs / 2);
  schedule(() => {
    const arrived = useLiftStore.getState().ride?.arrived;
    useLiftStore.getState().set({ ride: null, arrivedAt: arrived ? levelId : null });
  }, durationMs);
  return "riding";
}
