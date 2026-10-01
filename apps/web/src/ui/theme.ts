/**
 * Design tokens. `colors` is the world palette the 3D scene reads (bulbs,
 * name plates, confetti, light tints); the HUD reads CSS custom properties
 * (`--rg-*`) that `themeCssText()` declares and `App.tsx` injects once.
 *
 * The HUD is a retro lair control panel (#189, SPEC §12 "UI"; palettes in
 * theme/lairPalette.ts): its `--rg-color-*` values come from the light or
 * dark scheme, picked by the system theme (`prefers-color-scheme`).
 */
import {
  lairAccents,
  lairFonts,
  lampColors,
  type UiScheme,
  uiSchemes,
} from "./theme/lairPalette.ts";

/** World palette for the scene (unchanged by the HUD scheme). */
export const colors = {
  cream: "#FFF6D9",
  amber: "#F5A623",
  cyan: "#2DBFE8",
  blue: "#1E6FE0",
  orangeRed: "#F26522",
  crimson: "#B83159",
  navy: "#01008C",
  gold: "#F5C542",
  modalSurface: "#FFF9EF",
  panelSurface: "#FFFFFF",
  panelBorder: "#D9D9D9",
  ink: "#333333",
  inkMuted: "#6B6B6B",
  green: "#3DA35D",
} as const;

export const fonts = lairFonts;

/** Chunky but not round: machined plates with small radii. */
export const radii = { panel: 6, button: 5, chip: 999 } as const;

export const gradients = {
  primary:
    "linear-gradient(180deg, var(--rg-color-primary-top) 0%, var(--rg-color-primary-bottom) 100%)",
  destructive:
    "linear-gradient(180deg, var(--rg-color-danger-top) 0%, var(--rg-color-danger-bottom) 100%)",
  steel: "linear-gradient(180deg, var(--rg-color-steel-top) 0%, var(--rg-color-steel-bottom) 100%)",
  hazard:
    "repeating-linear-gradient(-45deg, var(--rg-color-hench-yellow) 0 8px, var(--rg-color-plate) 8px 16px)",
} as const;

export const shadows = {
  panel: "0 0 0 1px var(--rg-color-frame-shadow), 0 6px 18px rgba(0, 0, 0, 0.35)",
  modalGlow:
    "0 0 0 2px var(--rg-color-frame-shadow), 0 0 0 7px var(--rg-color-plate), 0 18px 48px rgba(0, 0, 0, 0.5)",
  toast: "0 0 0 1px var(--rg-color-frame-shadow), 0 8px 22px rgba(0, 0, 0, 0.35)",
} as const;

export const motion = {
  /** Dialog fade; SPEC §9.2 uses 300 ms for the view crossfade too. */
  fadeMs: 300,
  toastMs: 220,
} as const;

/** `camelCase` -> `kebab-case` for property names. */
export function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

const prefixed = (prefix: string, record: Readonly<Record<string, string>>) =>
  Object.fromEntries(Object.entries(record).map(([k, v]) => [`${prefix}-${kebab(k)}`, v]));

/** Tokens shared by both schemes: accents, lamps, fonts, radii, gradients, shadows, motion. */
export const themeTokens: Readonly<Record<string, string>> = {
  ...prefixed("color", lairAccents),
  ...prefixed("lamp", lampColors),
  "font-ui": fonts.ui,
  "font-stencil": fonts.stencil,
  "font-mono": fonts.mono,
  "radius-panel": `${radii.panel}px`,
  "radius-button": `${radii.button}px`,
  "radius-chip": `${radii.chip}px`,
  "gradient-primary": gradients.primary,
  "gradient-destructive": gradients.destructive,
  "gradient-steel": gradients.steel,
  "gradient-hazard": gradients.hazard,
  "shadow-panel": shadows.panel,
  "shadow-modal-glow": shadows.modalGlow,
  "shadow-toast": shadows.toast,
  "motion-fade": `${motion.fadeMs}ms`,
  "motion-toast": `${motion.toastMs}ms`,
};

/** The `--rg-color-*` values of one scheme. */
export function schemeTokens(scheme: UiScheme): Record<string, string> {
  return prefixed("color", { ...scheme });
}

export const CSS_VAR_PREFIX = "--rg-";

/** `cssVar("color-ink")` -> `var(--rg-color-ink)`. */
export function cssVar(token: string): string {
  return `var(${CSS_VAR_PREFIX}${token})`;
}

function declarations(tokens: Readonly<Record<string, string>>, indent: string): string {
  return Object.entries(tokens)
    .map(([k, v]) => `${indent}${CSS_VAR_PREFIX}${k}: ${v};`)
    .join("\n");
}

/**
 * The `:root` blocks declaring every token: shared ones and the light
 * scheme by default, the dark scheme under `prefers-color-scheme: dark`.
 */
export function themeCssText(): string {
  return [
    ":root {",
    "  color-scheme: light dark;",
    declarations(themeTokens, "  "),
    declarations(schemeTokens(uiSchemes.light), "  "),
    "}",
    "@media (prefers-color-scheme: dark) {",
    "  :root {",
    declarations(schemeTokens(uiSchemes.dark), "    "),
    "  }",
    "}",
  ].join("\n");
}
