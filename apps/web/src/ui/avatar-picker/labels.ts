/**
 * Picker and Settings text for geniuses (#185). Kept apart from the scene
 * modules so Settings can describe a genius without loading three.js.
 */
import type { GeniusArchetype, GeniusLookValue } from "@regulus/protocol/src/genius.ts";

/** Display names and one-liners for the picker. */
export const ARCHETYPE_INFO: Record<GeniusArchetype, { label: string; blurb: string }> = {
  scientist: { label: "Scientist", blurb: "Mad experiments, madder hair." },
  tycoon: { label: "Tycoon", blurb: "Owns the island. And the next one." },
  general: { label: "General", blurb: "Every henchman salutes twice." },
  hacker: { label: "Hacker", blurb: "Already inside your mainframe." },
  diva: { label: "Diva", blurb: "World domination, impeccably styled." },
  mastermind: { label: "Mastermind", blurb: "Seven plans ahead, minimum." },
};

/** Accessory display names for the picker. */
export const ACCESSORY_LABELS: Record<string, string> = {
  none: "None",
  goggles: "Goggles",
  flask: "Flask",
  bowtie: "Bow tie",
  top_hat: "Top hat",
  monocle: "Monocle",
  cigar: "Cigar",
  peaked_cap: "Peaked cap",
  medals: "Medals",
  moustache: "Moustache",
  headphones: "Headphones",
  visor: "Visor",
  beanie: "Beanie",
  sunglasses: "Sunglasses",
  pearls: "Pearls",
  tiara: "Tiara",
  cape: "Cape",
  eyepatch: "Eyepatch",
  collar: "High collar",
};

/** "Scientist in crimson with flask": the look in words (Settings, the preview's label). */
export function describeLook(look: GeniusLookValue): string {
  const accessory =
    look.accessory === "none" ? "" : ` with ${ACCESSORY_LABELS[look.accessory]?.toLowerCase()}`;
  return `${ARCHETYPE_INFO[look.archetype].label} in ${look.outfit}${accessory}`;
}
