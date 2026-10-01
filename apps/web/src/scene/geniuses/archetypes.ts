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
