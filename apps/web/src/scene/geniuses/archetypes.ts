/** The six genius archetypes (SPEC §9.3, D22): original designs, procedural low-poly. */
import type { GeniusArchetype } from "@regulus/protocol";
import { diva } from "./bodies/diva.ts";
import { general } from "./bodies/general.ts";
import { hacker } from "./bodies/hacker.ts";
import { mastermind } from "./bodies/mastermind.ts";
import { scientist } from "./bodies/scientist.ts";
import { tycoon } from "./bodies/tycoon.ts";
import type { ArchetypeModel } from "./bodies/types.ts";

export const ARCHETYPE_MODELS: Record<GeniusArchetype, ArchetypeModel> = {
  scientist,
  tycoon,
  general,
  hacker,
  diva,
  mastermind,
};

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
