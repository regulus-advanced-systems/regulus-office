/**
 * The coffee machine's e2e probe (#63), published on `window.__regulusCoffee`
 * with `?stats` like `__regulusNav`: where to stand to take a cup, the
 * player's own buzz as published and the speed factor now in force, and
 * the buzz this page was shown for every human it sees.
 */
import { useBuildingStore } from "../../state/building.ts";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { speedBoost } from "../movement/gait.ts";
import { selectSelfBuzz, shakes } from "./buzz.ts";

export interface CoffeeProbe {
  /** Where the drinker stands, compound metres; null on a level without a break room. */
  stand(): { x: number; z: number } | null;
  self(): { cups: number; buzzUntil: number; boost: number };
  /** By display name: the cups this page was shown, and whether it draws that body shaking. */
  seen(): Record<string, { cups: number; shaking: boolean }>;
}

declare global {
  interface Window {
    __regulusCoffee?: CoffeeProbe;
  }
}

export function createCoffeeProbe(stand: () => { x: number; z: number } | null): CoffeeProbe {
  return {
    stand,
    self() {
      const buzz = selectSelfBuzz(useBuildingStore.getState());
      return { cups: buzz?.cups ?? 0, buzzUntil: buzz?.buzzUntil ?? 0, boost: speedBoost() };
    },
    seen() {
      const reduced = selectReducedMotion(useUiStore.getState());
      const out: Record<string, { cups: number; shaking: boolean }> = {};
      for (const h of Object.values(useBuildingStore.getState().state?.humans ?? {}))
        out[h.displayName] = { cups: h.cups ?? 0, shaking: shakes(h.cups ?? 0, reduced) };
      return out;
    },
  };
}
