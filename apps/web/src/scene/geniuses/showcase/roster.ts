/** Deterministic genius rosters for the dev showcase and screenshots. */
import {
  ARCHETYPE_DEFAULTS,
  AVATAR_ANIMATIONS,
  type AvatarAnimation,
  accessoriesFor,
  GENIUS_ARCHETYPES,
  GENIUS_HAIRS,
  GENIUS_OUTFITS,
  GENIUS_SKINS,
  GENIUS_TRIMS,
  type GeniusArchetype,
  type GeniusLookValue,
} from "@regulus/protocol";

export interface ShowcaseGenius {
  key: string;
  look: GeniusLookValue;
  position: [number, number, number];
  animation: AvatarAnimation;
  name?: string;
}

const keys = <T extends object>(o: T) => Object.keys(o) as (keyof T)[];
const SKINS = keys(GENIUS_SKINS);
const HAIRS = keys(GENIUS_HAIRS);
const OUTFITS = keys(GENIUS_OUTFITS);
const TRIMS = keys(GENIUS_TRIMS);

export const defaultLook = (archetype: GeniusArchetype, i = 1): GeniusLookValue => ({
  ...ARCHETYPE_DEFAULTS[archetype],
  skin: SKINS[i % SKINS.length] ?? "light",
  hair: archetype === "scientist" ? "white" : (HAIRS[i % 4] ?? "black"),
});

/** The six archetypes side by side in their starting looks. */
export function lineup(animation: AvatarAnimation, spacing = 1.6): ShowcaseGenius[] {
  return GENIUS_ARCHETYPES.map((archetype, i) => ({
    key: archetype,
    look: defaultLook(archetype, i),
    position: [(i - 2.5) * spacing, 0, 0],
    animation,
  }));
}

/** One archetype in one row: every accessory (left) and four colour variants (right). */
export function variants(archetype: GeniusArchetype, animation: AvatarAnimation): ShowcaseGenius[] {
  const base = defaultLook(archetype, 1);
  const out: ShowcaseGenius[] = accessoriesFor(archetype).map((accessory, i, all) => ({
    key: `acc-${accessory}`,
    look: { ...base, accessory },
    position: [(i - all.length + 0.5) * 1.2, 0, 0],
    animation,
  }));
  for (let i = 0; i < 4; i++) {
    out.push({
      key: `col-${i}`,
      look: {
        ...base,
        outfit: OUTFITS[(i * 3 + 1) % OUTFITS.length] ?? base.outfit,
        trim: TRIMS[(i * 2 + 1) % TRIMS.length] ?? base.trim,
        skin: SKINS[(i * 2 + 3) % SKINS.length] ?? base.skin,
        hair: HAIRS[(i + 2) % HAIRS.length] ?? base.hair,
      },
      position: [(i + 0.5) * 1.2, 0, 0],
      animation,
    });
  }
  return out;
}

/** A grid of `count` mixed geniuses with mixed animations (performance probe). */
export function crowd(count: number): ShowcaseGenius[] {
  const columns = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, i) => {
    const archetype = GENIUS_ARCHETYPES[i % GENIUS_ARCHETYPES.length] as GeniusArchetype;
    const accessories = accessoriesFor(archetype);
    return {
      key: `g${i}`,
      look: {
        ...defaultLook(archetype, i),
        accessory: accessories[i % accessories.length] ?? "none",
      },
      position: [
        ((i % columns) - (columns - 1) / 2) * 1.6,
        0,
        (Math.floor(i / columns) - (columns - 1) / 2) * 1.6,
      ],
      animation: AVATAR_ANIMATIONS[i % AVATAR_ANIMATIONS.length] ?? "idle",
      name: `Genius ${i + 1}`,
    };
  });
}
