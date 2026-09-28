/** Art direction tokens from SPEC §12 (full reference in docs/research/03). */
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
  ink: "#1F1F1F",
  inkMuted: "#6B6B6B",
} as const;

export const fonts = {
  ui: '"Open Sans", "Segoe UI", system-ui, sans-serif',
} as const;

export const radii = { panel: 12, button: 8 } as const;

/** Orange gradient primary button (SPEC §12). */
export const gradients = {
  primary: `linear-gradient(180deg, ${colors.amber} 0%, ${colors.orangeRed} 100%)`,
} as const;
