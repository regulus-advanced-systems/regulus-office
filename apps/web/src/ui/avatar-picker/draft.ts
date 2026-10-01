/**
 * The picker's draft look: pure edits, always valid. Switching archetype
 * keeps the colours and swaps the accessory for the new archetype's own
 * starting one (accessories belong to an archetype).
 */
import {
  ARCHETYPE_DEFAULTS,
  accessoriesFor,
  DEFAULT_GENIUS_LOOK,
  type GeniusAccessory,
  type GeniusArchetype,
  type GeniusColorSlot,
  type GeniusLookValue,
  resolveGeniusLook,
} from "@regulus/protocol/src/genius.ts";

export function initialDraft(current: GeniusLookValue | undefined): GeniusLookValue {
  return current ? resolveGeniusLook(current) : { ...DEFAULT_GENIUS_LOOK };
}

export function withArchetype(look: GeniusLookValue, archetype: GeniusArchetype): GeniusLookValue {
  if (look.archetype === archetype) return look;
  return { ...look, archetype, accessory: ARCHETYPE_DEFAULTS[archetype].accessory };
}

export function withColor(
  look: GeniusLookValue,
  slot: GeniusColorSlot,
  id: string,
): GeniusLookValue {
  return resolveGeniusLook({ ...look, [slot]: id });
}

export function withAccessory(look: GeniusLookValue, accessory: GeniusAccessory): GeniusLookValue {
  return (accessoriesFor(look.archetype) as readonly string[]).includes(accessory)
    ? { ...look, accessory }
    : look;
}

/** Same look, field by field. */
export const sameLook = (a: GeniusLookValue, b: GeniusLookValue): boolean =>
  (Object.keys(a) as (keyof GeniusLookValue)[]).every((k) => a[k] === b[k]);
