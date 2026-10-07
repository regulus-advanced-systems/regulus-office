/**
 * Character forms (#281): every body the lair crew can be drawn in.
 *
 * The henchman skins (skins.ts) are the forms an admin `skin_rules` row may
 * give a coding henchman, and the set the database constrains. Office agents
 * (office-agents.ts) pick their appearance from a wider list: every skin plus
 * the forms only an office agent wears, which start with the `secretary`.
 * Keeping those in a sibling list means a skin rule can never put a coding
 * henchman in an office-agent form, and adding one needs no migration.
 */
import { DEFAULT_SKIN_ID, HENCHMAN_SKIN_IDS, HENCHMAN_SKIN_LABELS } from "./skins.ts";

/** Forms only an office agent can wear. */
export const OFFICE_AGENT_ONLY_FORM_IDS = ["secretary"] as const;
export type OfficeAgentOnlyFormId = (typeof OFFICE_AGENT_ONLY_FORM_IDS)[number];

/** Every form an office agent can be given, in gallery order. */
export const CHARACTER_FORM_IDS = [...HENCHMAN_SKIN_IDS, ...OFFICE_AGENT_ONLY_FORM_IDS] as const;
export type CharacterFormId = (typeof CHARACTER_FORM_IDS)[number];
export const DEFAULT_FORM_ID: CharacterFormId = DEFAULT_SKIN_ID;

export const CHARACTER_FORM_LABELS: Readonly<Record<CharacterFormId, string>> = {
  ...HENCHMAN_SKIN_LABELS,
  secretary: "Secretary",
};

export function isCharacterFormId(value: unknown): value is CharacterFormId {
  return typeof value === "string" && (CHARACTER_FORM_IDS as readonly string[]).includes(value);
}

/** A form id from the wire; anything unknown is the standard jumpsuit. */
export function formIdFor(value: string | undefined): CharacterFormId {
  return isCharacterFormId(value) ? value : DEFAULT_FORM_ID;
}
