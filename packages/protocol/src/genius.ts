/**
 * Genius avatars for humans (SPEC §5 `user_profiles.avatar`, §9.3, D22): one
 * of six original archetypes, four colour choices and one accessory from the
 * archetype's own list. The catalogue lives here so the server validates
 * exactly what the picker offers and the scene draws. Plain TypeScript, no
 * zod: the light session store imports it without pulling zod into the
 * login chunk (the zod shape is `GeniusLook` in building-state.ts).
 */

export const GENIUS_ARCHETYPES = [
  "scientist",
  "tycoon",
  "general",
  "hacker",
  "diva",
  "mastermind",
] as const;
export type GeniusArchetype = (typeof GENIUS_ARCHETYPES)[number];

/** Colour choices: id to hex. Ids go on the wire and in the database, never hex. */
export const GENIUS_OUTFITS = {
  ivory: "#E9E2D0",
  charcoal: "#3A3D45",
  crimson: "#A3242F",
  navy: "#233A63",
  olive: "#5C6B3A",
  plum: "#5E3A6E",
  teal: "#1F7A74",
  mustard: "#C99A2E",
} as const;
export const GENIUS_TRIMS = {
  brass: "#C9A227",
  silver: "#B8BEC6",
  scarlet: "#D7263D",
  teal: "#2EC4B6",
  onyx: "#1E1F24",
  pearl: "#F2EEE6",
} as const;
export const GENIUS_SKINS = {
  fair: "#F4D7C0",
  light: "#E6B998",
  tan: "#CF9A6E",
  olive: "#B07F52",
  brown: "#8A5A3B",
  deep: "#5C3A26",
} as const;
export const GENIUS_HAIRS = {
  black: "#1F1B1A",
  brown: "#5A3A24",
  auburn: "#8E3B1E",
  blond: "#D8B45A",
  grey: "#9A9A9A",
  white: "#ECEAE4",
} as const;

export type GeniusOutfit = keyof typeof GENIUS_OUTFITS;
export type GeniusTrim = keyof typeof GENIUS_TRIMS;
export type GeniusSkin = keyof typeof GENIUS_SKINS;
export type GeniusHair = keyof typeof GENIUS_HAIRS;

/** The colour slots of a look and their palettes. */
export const GENIUS_COLOR_SLOTS = {
  outfit: GENIUS_OUTFITS,
  trim: GENIUS_TRIMS,
  skin: GENIUS_SKINS,
  hair: GENIUS_HAIRS,
} as const;
export type GeniusColorSlot = keyof typeof GENIUS_COLOR_SLOTS;

/** "No accessory" is valid for every archetype. */
export const NO_ACCESSORY = "none";

/** Two or three accessories per archetype (SPEC §9.3). */
export const GENIUS_ACCESSORIES = {
  scientist: ["goggles", "flask", "bowtie"],
  tycoon: ["top_hat", "monocle", "cigar"],
  general: ["peaked_cap", "medals", "moustache"],
  hacker: ["headphones", "visor", "beanie"],
  diva: ["sunglasses", "pearls", "tiara"],
  mastermind: ["cape", "eyepatch", "collar"],
} as const satisfies Record<GeniusArchetype, readonly string[]>;
export type GeniusAccessory =
  | (typeof GENIUS_ACCESSORIES)[GeniusArchetype][number]
  | typeof NO_ACCESSORY;

/** A human's genius: archetype, colour ids and accessory id (SPEC §5 `user_profiles.avatar`). */
export interface GeniusLookValue {
  archetype: GeniusArchetype;
  outfit: GeniusOutfit;
  trim: GeniusTrim;
  skin: GeniusSkin;
  hair: GeniusHair;
  accessory: GeniusAccessory;
}

/** The look of a human who has not picked yet, and of every pre-#185 profile. */
export const DEFAULT_GENIUS_LOOK: GeniusLookValue = {
  archetype: "mastermind",
  outfit: "charcoal",
  trim: "brass",
  skin: "light",
  hair: "black",
  accessory: "none",
};

/** A sensible starting look per archetype for the picker (colours that read as that genius). */
export const ARCHETYPE_DEFAULTS: Record<GeniusArchetype, Omit<GeniusLookValue, "skin" | "hair">> = {
  scientist: { archetype: "scientist", outfit: "ivory", trim: "teal", accessory: "goggles" },
  tycoon: { archetype: "tycoon", outfit: "plum", trim: "brass", accessory: "top_hat" },
  general: { archetype: "general", outfit: "olive", trim: "brass", accessory: "peaked_cap" },
  hacker: { archetype: "hacker", outfit: "charcoal", trim: "teal", accessory: "headphones" },
  diva: { archetype: "diva", outfit: "crimson", trim: "pearl", accessory: "sunglasses" },
  mastermind: { archetype: "mastermind", outfit: "charcoal", trim: "scarlet", accessory: "cape" },
};

const has = (record: object, key: unknown): boolean =>
  typeof key === "string" && Object.hasOwn(record, key);

export const isGeniusArchetype = (value: unknown): value is GeniusArchetype =>
  typeof value === "string" && (GENIUS_ARCHETYPES as readonly string[]).includes(value);

/** Accessories an archetype may wear, "none" first. */
export function accessoriesFor(archetype: GeniusArchetype): readonly GeniusAccessory[] {
  return [NO_ACCESSORY, ...GENIUS_ACCESSORIES[archetype]];
}

export type GeniusLookCheck =
  | { ok: true; look: GeniusLookValue }
  | { ok: false; fields: (keyof GeniusLookValue)[] };

/**
 * Validate an untrusted look (request body, stored JSON). Every field must be
 * a known id and the accessory must belong to the archetype. Extra keys are
 * dropped. Returns the offending field names otherwise.
 */
export function checkGeniusLook(raw: unknown): GeniusLookCheck {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fields: (keyof GeniusLookValue)[] = [];
  if (!isGeniusArchetype(value.archetype)) fields.push("archetype");
  for (const slot of Object.keys(GENIUS_COLOR_SLOTS) as GeniusColorSlot[]) {
    if (!has(GENIUS_COLOR_SLOTS[slot], value[slot])) fields.push(slot);
  }
  const archetype = isGeniusArchetype(value.archetype) ? value.archetype : undefined;
  const accessory = value.accessory;
  if (
    typeof accessory !== "string" ||
    (accessory !== NO_ACCESSORY &&
      !(archetype && (GENIUS_ACCESSORIES[archetype] as readonly string[]).includes(accessory)))
  ) {
    fields.push("accessory");
  }
  if (fields.length > 0) return { ok: false, fields };
  return {
    ok: true,
    look: {
      archetype: value.archetype as GeniusArchetype,
      outfit: value.outfit as GeniusOutfit,
      trim: value.trim as GeniusTrim,
      skin: value.skin as GeniusSkin,
      hair: value.hair as GeniusHair,
      accessory: accessory as GeniusAccessory,
    },
  };
}

/**
 * Best-effort look for rendering: each invalid field falls back to the
 * default (an accessory from another archetype becomes "none"), so a stale
 * or partial value never breaks the scene.
 */
export function resolveGeniusLook(raw: unknown): GeniusLookValue {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const archetype = isGeniusArchetype(value.archetype)
    ? value.archetype
    : DEFAULT_GENIUS_LOOK.archetype;
  const pick = <K extends GeniusColorSlot>(slot: K): GeniusLookValue[K] =>
    (has(GENIUS_COLOR_SLOTS[slot], value[slot])
      ? value[slot]
      : DEFAULT_GENIUS_LOOK[slot]) as GeniusLookValue[K];
  const accessory = (accessoriesFor(archetype) as readonly unknown[]).includes(value.accessory)
    ? (value.accessory as GeniusAccessory)
    : NO_ACCESSORY;
  return {
    archetype,
    outfit: pick("outfit"),
    trim: pick("trim"),
    skin: pick("skin"),
    hair: pick("hair"),
    accessory,
  };
}

/** Stable cache key for a look (geometry is built once per distinct look). */
export const geniusLookKey = (look: GeniusLookValue): string =>
  [look.archetype, look.outfit, look.trim, look.skin, look.hair, look.accessory].join("/");

/** `PUT` a `GeniusLook` here to change the signed-in human's genius; `GET /api/me` reads it. */
export const GENIUS_AVATAR_API_PATH = "/api/me/avatar";
