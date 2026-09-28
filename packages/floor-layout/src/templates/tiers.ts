/** Tier registry: desks per tier (SPEC §9.1) and template lookup. */
import type { FloorTemplate, FloorTier } from "../types.ts";
import { largeTemplate } from "./large.ts";
import { lobbyTemplate } from "./lobby.ts";
import { officeL2Template } from "./office-l2.ts";
import { smallTemplate } from "./small.ts";

export const DESKS_PER_TIER: Readonly<Record<FloorTier, number>> = {
  small: 6,
  medium: 12,
  large: 20,
};

/** Tiers in growth order; a floor moves to the next one when desks run out. */
export const TIER_ORDER: readonly FloorTier[] = ["small", "medium", "large"];

export const TIER_TEMPLATES: Readonly<Record<FloorTier, FloorTemplate>> = {
  small: smallTemplate,
  medium: officeL2Template,
  large: largeTemplate,
};

/** Every template keyed by id (lobby included). */
export const TEMPLATES: ReadonlyMap<string, FloorTemplate> = new Map(
  [lobbyTemplate, smallTemplate, officeL2Template, largeTemplate].map((t) => [t.id, t]),
);

export function templateForTier(tier: FloorTier): FloorTemplate {
  return TIER_TEMPLATES[tier];
}

export function templateById(id: string): FloorTemplate | undefined {
  return TEMPLATES.get(id);
}

/** Smallest tier with at least `deskCount` desks, or `undefined` when none fits. */
export function tierForDeskCount(deskCount: number): FloorTier | undefined {
  return TIER_ORDER.find((tier) => DESKS_PER_TIER[tier] >= deskCount);
}

/** Next larger tier, or `undefined` at the top. */
export function nextTier(tier: FloorTier): FloorTier | undefined {
  return TIER_ORDER[TIER_ORDER.indexOf(tier) + 1];
}
