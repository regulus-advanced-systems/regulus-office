/**
 * Per-user robot looks (SPEC §9.3): a named colour set (primary body colour,
 * secondary joint colour, accent for accessories/badge) and an accessory.
 * `AvatarLook.colorSet` / `.accessory` are free strings on the wire; unknown
 * values fall back to defaults here so a stale profile never breaks rendering.
 * Colour sets follow the GDT palettes in SPEC §12.
 */
import type { AvatarLook, ProviderId } from "@regulus/protocol";
import { colors } from "../../ui/theme.ts";

export type ColorSet = Readonly<{ primary: string; secondary: string; accent: string }>;

export const COLOR_SETS: Readonly<Record<string, ColorSet>> = {
  teal: { primary: "#2A9D8F", secondary: "#E9E4D0", accent: colors.amber },
  oak: { primary: "#B5773C", secondary: "#F1E3C6", accent: colors.cyan },
  sky: { primary: "#4DA8DA", secondary: "#F4F1E8", accent: colors.orangeRed },
  orange: { primary: colors.orangeRed, secondary: "#F7E7C6", accent: colors.navy },
  lime: { primary: "#9BC53D", secondary: "#EFF3DD", accent: colors.crimson },
  mustard: { primary: "#E0B227", secondary: "#F5EFD9", accent: colors.blue },
  crimson: { primary: colors.crimson, secondary: "#F3E2E4", accent: colors.amber },
  navy: { primary: colors.navy, secondary: "#DDE2F4", accent: colors.amber },
  cream: { primary: "#F2E8C9", secondary: "#8A8477", accent: colors.cyan },
  graphite: { primary: "#4A4E57", secondary: "#C9CCD1", accent: colors.amber },
};

export const DEFAULT_COLOR_SET_ID = "teal";
export const COLOR_SET_IDS: readonly string[] = Object.keys(COLOR_SETS);

export function colorSetFor(id: string | undefined): ColorSet {
  return (id && COLOR_SETS[id]) || (COLOR_SETS[DEFAULT_COLOR_SET_ID] as ColorSet);
}

export const ACCESSORIES = ["antenna", "visor", "cap"] as const;
export type Accessory = (typeof ACCESSORIES)[number];
export const DEFAULT_ACCESSORY: Accessory = "antenna";

export function accessoryFor(id: string | undefined): Accessory {
  return (ACCESSORIES as readonly string[]).includes(id ?? "")
    ? (id as Accessory)
    : DEFAULT_ACCESSORY;
}

/** Resolved look: what the component actually renders for an `AvatarLook`. */
export type ResolvedLook = Readonly<{ colors: ColorSet; accessory: Accessory }>;

export function resolveLook(look: Partial<AvatarLook> | undefined): ResolvedLook {
  return { colors: colorSetFor(look?.colorSet), accessory: accessoryFor(look?.accessory) };
}

/**
 * Which colour of the set a material of the source model takes. The GLB has
 * three materials: `Main` (body panels), `Grey` (joints, feet) and `Black`
 * (face). Unknown names take the primary colour.
 */
export type MaterialRole = "primary" | "secondary" | "dark";
export const FACE_COLOR = "#1B1B1F";

export function materialRoleFor(materialName: string): MaterialRole {
  if (materialName.startsWith("Grey")) return "secondary";
  if (materialName.startsWith("Black")) return "dark";
  return "primary";
}

export function colorForRole(role: MaterialRole, set: ColorSet): string {
  if (role === "secondary") return set.secondary;
  if (role === "dark") return FACE_COLOR;
  return set.primary;
}

/**
 * Chest light colour per provider (SPEC §9.3 "provider logo-coloured chest
 * light"). Approximations of each provider's brand colour; the component
 * takes an explicit `chestLight` colour so callers can override.
 */
export const PROVIDER_LIGHT_COLORS: Readonly<Record<ProviderId, string>> = {
  "claude-code": "#D97757",
  codex: "#10A37F",
  "gemini-cli": "#4285F4",
  opencode: "#F4F4F4",
  "kimi-code": "#6A5BFF",
  custom: colors.cyan,
};

export function providerLightColor(provider: ProviderId | undefined): string | undefined {
  return provider ? PROVIDER_LIGHT_COLORS[provider] : undefined;
}
