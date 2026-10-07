/**
 * The built-in forms (#184, #281; SPEC §9.3 D22): what each henchman skin and
 * office-agent form from @regulus/protocol looks like. A form is a palette
 * (palette.ts), a body build, what it wears on the head (head.ts,
 * headwear.ts), an outfit layer (outfits.ts) and which jumpsuit details it
 * keeps. Geometry is built once per form (and hair style, for the standard
 * crew) and shared by everyone wearing it; the provider trim, the skin tone
 * and the hair colour only change the material.
 */
import { type CharacterFormId, formIdFor } from "@regulus/protocol";
import type { BufferGeometry } from "three";
import { type BodyOptions, bodyParts } from "./body.ts";
import { hairParts, headParts } from "./head.ts";
import { type Headwear, headwearParts } from "./headwear.ts";
import { type Outfit, outfitParts } from "./outfits.ts";
import { HENCHMAN_YELLOW, type Palette, STANDARD_PALETTE } from "./palette.ts";
import { secretaryParts } from "./secretary.ts";
import { mergeParts, type V3 } from "./shapes.ts";
import { type LightBuild, lightCentre } from "./statusLight.ts";
import {
  type CrewVariant,
  DEFAULT_VARIANT,
  HAIR_COLOURS,
  type HairStyle,
  SKIN_TONES,
} from "./variety.ts";

export interface SkinLook {
  palette: Palette;
  /** The jumpsuit body with these details, or the secretary's own body. */
  body: BodyOptions | "secretary";
  /** `crew`: bare-headed, the hair style from the wearer's id; else the form's own head dress. */
  head: "crew" | Headwear;
  outfit: Outfit;
  /** The hair colour comes from the wearer's id (else the form's own). */
  variedHair: boolean;
  /** Bare hands: the gloves take the wearer's skin tone. */
  bareHands: boolean;
  /** Carries a clipboard in the left arm (the `Henchman|Hold` overlay). */
  holds: boolean;
}

const DARK_SHOES = "#1A1A1D";

export const SKIN_LOOKS: Readonly<Record<CharacterFormId, SkinLook>> = {
  standard: {
    palette: STANDARD_PALETTE,
    body: { armbands: true, kneePads: false, workwear: true },
    head: "crew",
    outfit: "jumpsuit",
    variedHair: true,
    bareHands: false,
    holds: false,
  },
  lab_coat: {
    palette: {
      ...STANDARD_PALETTE,
      suit: "#F1F1EC",
      suitDark: "#C9CDD0",
      pants: "#5E6470",
      gloves: "#BFD8E2",
      boots: DARK_SHOES,
      belt: "#5E6470",
      metal: "#B9BEC4",
      hair: "#D9D6CF",
      hatDark: "#3A3A40",
      lens: "#78C9D9",
    },
    body: { armbands: false, kneePads: false, workwear: false, shoes: true },
    head: "lab",
    outfit: "labcoat",
    variedHair: false,
    bareHands: false,
    holds: false,
  },
  black_ops: {
    palette: {
      ...STANDARD_PALETTE,
      suit: "#2E3238",
      pants: "#2E3238",
      suitDark: "#444A53",
      boots: "#17181B",
      gloves: "#1D1E22",
      belt: "#4B5236",
      metal: "#6B6F76",
      hat: "#23262B",
      hatDark: "#15161A",
      hair: "#1B1B1F",
    },
    body: { armbands: true, kneePads: true, workwear: false },
    head: "watchcap",
    outfit: "vest",
    variedHair: false,
    bareHands: false,
    holds: false,
  },
  chef: {
    palette: {
      ...STANDARD_PALETTE,
      suit: "#F6F4EE",
      suitDark: "#2B2B30",
      pants: "#54575E",
      white: "#FFFFFF",
      boots: DARK_SHOES,
      belt: "#F6F4EE",
      metal: "#F6F4EE",
      hatDark: "#3A3A40",
    },
    body: { armbands: false, kneePads: false, workwear: false, shoes: true },
    head: "chefcap",
    outfit: "chef",
    variedHair: true,
    bareHands: true,
    holds: false,
  },
  number_two: {
    palette: {
      ...STANDARD_PALETTE,
      suit: "#3A3F4B",
      pants: "#3A3F4B",
      suitDark: "#2A2E37",
      shirt: "#F4F1E8",
      boots: DARK_SHOES,
      belt: "#1A1A1D",
      metal: "#C9A227",
      hair: "#2A1F18",
    },
    body: { armbands: false, kneePads: false, workwear: false, shoes: true },
    head: "slick",
    outfit: "suit",
    variedHair: false,
    bareHands: true,
    holds: false,
  },
  secretary: {
    palette: {
      ...STANDARD_PALETTE,
      suit: "#3C6E71",
      suitDark: "#2B5053",
      pants: "#4B3F45",
      shirt: "#F4EFE2",
      white: "#FBFAF4",
      boots: "#1E1B1E",
      belt: "#7A5230",
      metal: "#C9A227",
      accent: "#B8323C",
      hair: "#5A2E1C",
    },
    body: "secretary",
    head: "updo",
    outfit: "jumpsuit",
    variedHair: true,
    bareHands: true,
    holds: true,
  },
};

/** The look for a skin or form id from the wire (unknown ids wear the standard jumpsuit). */
export function skinLook(skin: string | undefined): SkinLook {
  return SKIN_LOOKS[formIdFor(skin)];
}

/**
 * The palette of one wearer: the form's colours with the provider colour as
 * trim (the form's own without one) and the wearer's skin tone and, where the
 * form leaves it open, hair colour.
 */
export function paletteFor(
  skin: string | undefined,
  trim: string | undefined,
  variant: CrewVariant = DEFAULT_VARIANT,
): Palette {
  const look = skinLook(skin);
  if (!trim && variant === DEFAULT_VARIANT) return look.palette;
  const tone = SKIN_TONES[variant.tone % SKIN_TONES.length] ?? {
    skin: look.palette.skin,
    skinShade: look.palette.skinShade,
  };
  return {
    ...look.palette,
    ...(trim ? { trim } : {}),
    ...(variant === DEFAULT_VARIANT ? {} : tone),
    ...(variant !== DEFAULT_VARIANT && look.bareHands ? { gloves: tone.skin } : {}),
    ...(variant !== DEFAULT_VARIANT && look.variedHair
      ? { hair: HAIR_COLOURS[variant.hairColour % HAIR_COLOURS.length] ?? look.palette.hair }
      : {}),
  };
}

/** Which body the form is built on (where its status lamps sit). */
export function buildOf(skin: string | undefined): LightBuild {
  return skinLook(skin).body === "secretary" ? "secretary" : "crew";
}

/** The point between the two status lamps for a form, model space. */
export function lightAt(skin: string | undefined): V3 {
  return lightCentre(buildOf(skin));
}

/** The hair style a wearer of this form gets: its own for the standard crew, else none to choose. */
export function hairOf(skin: string | undefined, variant: CrewVariant): HairStyle | undefined {
  return skinLook(skin).head === "crew" ? variant.hair : undefined;
}

const geometries = new Map<string, BufferGeometry>();

/** The merged, skinned geometry of a form (cached per form and hair style; callers must not mutate it). */
export function skinGeometry(
  skin: string | undefined,
  variant: CrewVariant = DEFAULT_VARIANT,
): BufferGeometry {
  const id = formIdFor(skin);
  const look = SKIN_LOOKS[id];
  const hair = look.head === "crew" ? variant.hair : undefined;
  const key = hair ? `${id}:${hair}` : id;
  let g = geometries.get(key);
  if (!g) {
    g = mergeParts([
      ...(look.body === "secretary" ? secretaryParts() : bodyParts(look.body)),
      ...headParts(look.body === "secretary" ? { lips: true, fine: true } : {}),
      ...(look.head === "crew" ? hairParts(hair ?? "crop") : headwearParts(look.head)),
      ...outfitParts(look.outfit),
    ]);
    g.name = `henchman:${key}`;
    geometries.set(key, g);
  }
  return g;
}

export { HENCHMAN_YELLOW };
