/**
 * Who a crew member is (#281): a hair style, a hair colour and a skin tone
 * picked from its id, so the crew reads as different people and each one
 * looks the same on every screen and after every reload. Pure.
 */

export const HAIR_STYLES = ["crop", "buzz", "part", "flattop", "ponytail", "balding"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

/** Skin and its shade (nose, ears' shadow, stubble). */
export const SKIN_TONES: ReadonlyArray<{ skin: string; skinShade: string }> = [
  { skin: "#E9B48C", skinShade: "#C98C66" },
  { skin: "#F3CDA9", skinShade: "#D9A47C" },
  { skin: "#D29B6C", skinShade: "#AE7648" },
  { skin: "#B0764A", skinShade: "#8C5832" },
  { skin: "#8A5733", skinShade: "#6A3F22" },
  { skin: "#5F3B25", skinShade: "#472A19" },
];

export const HAIR_COLOURS: readonly string[] = [
  "#2A1F18",
  "#17171B",
  "#5A3A22",
  "#8C5A2B",
  "#C9A25A",
  "#A8431F",
  "#8D8D8F",
];

export interface CrewVariant {
  hair: HairStyle;
  /** Index into `SKIN_TONES`. */
  tone: number;
  /** Index into `HAIR_COLOURS`. */
  hairColour: number;
}

/** The look of a henchman nobody named (previews, build sites). */
export const DEFAULT_VARIANT: CrewVariant = { hair: "crop", tone: 0, hairColour: 0 };

/** FNV-1a with a final mix, so ids that differ in one character land far apart. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The variant for an id (a henchman's agent id); the default one without an id. */
export function crewVariant(id: string | undefined): CrewVariant {
  if (!id) return DEFAULT_VARIANT;
  const h = hashId(id);
  return {
    hair: HAIR_STYLES[h % HAIR_STYLES.length] as HairStyle,
    tone: (h >>> 8) % SKIN_TONES.length,
    hairColour: (h >>> 16) % HAIR_COLOURS.length,
  };
}
