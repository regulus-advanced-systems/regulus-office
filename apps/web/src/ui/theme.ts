/**
 * Art direction tokens from SPEC §12 (full reference in docs/research/03 §5).
 * The same values are exposed as CSS custom properties (`--rg-*`) through
 * `themeCssText()`, which `App.tsx` injects once, so CSS classes in
 * globals.css / components.css and inline styles share one source of truth.
 */
export const colors = {
  cream: "#FFF6D9",
  amber: "#F5A623",
  cyan: "#2DBFE8",
  blue: "#1E6FE0",
  orangeRed: "#F26522",
  crimson: "#B83159",
  navy: "#01008C",
  /** Modal border and surface (SPEC §12 "golden-bordered modals on #FFF9EF"). */
  gold: "#F5C542",
  modalSurface: "#FFF9EF",
  panelSurface: "#FFFFFF",
  panelBorder: "#D9D9D9",
  /** Charcoal body text (research 03 §5). */
  ink: "#333333",
  inkMuted: "#6B6B6B",
  /** Cash-green from the GDT status box. */
  green: "#3DA35D",
} as const;

export const fonts = {
  ui: '"Open Sans", "Segoe UI", system-ui, sans-serif',
} as const;

export const radii = { panel: 12, button: 8, chip: 999 } as const;

/** Orange gradient primary button (SPEC §12); the red one is for destructive actions. */
export const gradients = {
  primary: `linear-gradient(180deg, ${colors.amber} 0%, ${colors.orangeRed} 100%)`,
  destructive: `linear-gradient(180deg, #D94A6B 0%, ${colors.crimson} 100%)`,
} as const;

export const shadows = {
  panel: "0 2px 8px rgba(0, 0, 0, 0.08)",
  /** Cream glow around modals. */
  modalGlow: "0 0 0 6px rgba(255, 246, 217, 0.9), 0 12px 40px rgba(0, 0, 0, 0.18)",
  toast: "0 6px 20px rgba(0, 0, 0, 0.14)",
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

/** Flat token map: property name (without the `--rg-` prefix) to value. */
export const themeTokens: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(colors).map(([k, v]) => [`color-${kebab(k)}`, v])),
  "font-ui": fonts.ui,
  "radius-panel": `${radii.panel}px`,
  "radius-button": `${radii.button}px`,
  "radius-chip": `${radii.chip}px`,
  "gradient-primary": gradients.primary,
  "gradient-destructive": gradients.destructive,
  "shadow-panel": shadows.panel,
  "shadow-modal-glow": shadows.modalGlow,
  "shadow-toast": shadows.toast,
  "motion-fade": `${motion.fadeMs}ms`,
  "motion-toast": `${motion.toastMs}ms`,
};

export const CSS_VAR_PREFIX = "--rg-";

/** `cssVar("color-cream")` -> `var(--rg-color-cream)`. */
export function cssVar(token: string): string {
  return `var(${CSS_VAR_PREFIX}${token})`;
}

/** A `:root { --rg-...: ...; }` block declaring every token. */
export function themeCssText(): string {
  const lines = Object.entries(themeTokens).map(([k, v]) => `  ${CSS_VAR_PREFIX}${k}: ${v};`);
  return `:root {\n${lines.join("\n")}\n}`;
}
