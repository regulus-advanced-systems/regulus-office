/**
 * Footstep hook (issue #15): watches the local player's distance walked and,
 * every stride, dispatches a `regulus:footstep` event on `window` and plays
 * the generated click unless reduced motion is on (SPEC §11; the settings
 * store mirrors the flag to `<html data-reduced-motion>`).
 */
import { useEffect } from "react";
import { usePlayerStore } from "../state/player.ts";
import { selectReducedMotion, useUiStore } from "../state/ui.ts";
import { createFootstepCadence } from "./footstepCadence.ts";
import { playFootstep } from "./footstepSound.ts";

export const FOOTSTEP_EVENT = "regulus:footstep";

export interface FootstepEventDetail {
  x: number;
  z: number;
}

export function isReducedMotion(doc: Document | undefined = globalThis.document): boolean {
  if (doc?.documentElement.dataset.reducedMotion === "true") return true;
  return selectReducedMotion(useUiStore.getState());
}

export interface FootstepsOptions {
  store?: typeof usePlayerStore;
  play?: () => void;
  reduced?: () => boolean;
  target?: EventTarget;
}

/** Subscribe to the player's strides; returns the unsubscribe function. */
export function watchFootsteps(options: FootstepsOptions = {}): () => void {
  const store = options.store ?? usePlayerStore;
  const play = options.play ?? playFootstep;
  const reduced = options.reduced ?? isReducedMotion;
  const target = options.target ?? window;
  const cadence = createFootstepCadence();
  cadence.reset(store.getState().distanceWalked);
  return store.subscribe((s, prev) => {
    if (s.distanceWalked === prev.distanceWalked) return;
    const steps = cadence.advance(s.distanceWalked);
    if (steps === 0) return;
    const detail: FootstepEventDetail = { x: s.x, z: s.z };
    target.dispatchEvent(new CustomEvent(FOOTSTEP_EVENT, { detail }));
    if (!reduced()) play();
  });
}

export function useFootsteps(options?: FootstepsOptions): void {
  useEffect(() => watchFootsteps(options), [options]);
}
