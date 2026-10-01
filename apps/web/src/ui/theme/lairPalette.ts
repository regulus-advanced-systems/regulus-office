/**
 * The HUD's retro lair control-panel look (#189, SPEC §12 "UI"): dark
 * gunmetal panels in brass frames with riveted corners and stencil headings,
 * lamp-style status chips and chunky switches. Original design: no logo, UI
 * art or font from any commercial game (D23).
 *
 * Two schemes follow the system theme: `dark` ("night shift", gunmetal) and
 * `light` ("day shift", cream console enamel). Both keep the brass frames,
 * the dark nameplate headings and the lamps, so either reads as the same
 * control panel. Every value here becomes a `--rg-color-*` custom property
 * (see theme.ts); the names the feature CSS already used (`blue`, `navy`,
 * `crimson`, ...) are kept as roles, so they mean "link/accent", "rule",
 * "danger text" and so on, with a value per scheme.
 */

/** Accent colours from the SPEC §12 palette, shared by both schemes. */
export const lairAccents = {
  henchYellow: "#F2C200",
  alarmRed: "#D7263D",
  consoleTeal: "#2EC4B6",
  brass: "#C9A227",
} as const;

/** The semantic roles every scheme defines. */
export interface UiScheme {
  /** Page behind everything (login pages, the area around the canvas). */
  page: string;
  pageEdge: string;
  /** Panel and dialog faces. */
  panelSurface: string;
  modalSurface: string;
  /** Raised parts on a panel: cards, list rows, options. */
  raised: string;
  /** Recessed wells: inputs, code, board columns, switch tracks. */
  inset: string;
  /** Hairlines inside panels. */
  panelBorder: string;
  /** Edges of inputs and switch tracks (WCAG 1.4.11: 3:1 against what is around them). */
  inputEdge: string;
  /** Brass frame, its shadowed bevel and its lit edge. */
  gold: string;
  frameShadow: string;
  frameLight: string;
  rivet: string;
  /** Text. */
  ink: string;
  inkMuted: string;
  /** Stencil headings on a panel face. */
  heading: string;
  /** Nameplates (dialog titles, lamp chips): dark plate, yellow stencil. */
  plate: string;
  plateInk: string;
  /** Plain text on a plate. */
  plateText: string;
  /** Links, ghost buttons, focus rings, the selected outline (was blue). */
  blue: string;
  /** Text on a `blue` fill. */
  onBlue: string;
  /** Selected and hover fills. */
  selected: string;
  hover: string;
  /** Status text roles on panel faces. */
  green: string;
  crimson: string;
  amber: string;
  orangeRed: string;
  cyan: string;
  /** Rules under headings, author names (was navy). */
  navy: string;
  /** Primary button: henchman yellow with dark ink. */
  primaryTop: string;
  primaryBottom: string;
  primaryInk: string;
  primaryEdge: string;
  /** Destructive button: alarm red with light ink. */
  dangerTop: string;
  dangerBottom: string;
  dangerInk: string;
  dangerEdge: string;
  /** Secondary button: painted steel. */
  steelTop: string;
  steelBottom: string;
  steelEdge: string;
  /** Dialog backdrop over the scene. */
  backdrop: string;
}

export const darkScheme: UiScheme = {
  page: "#1A1814",
  pageEdge: "#0C0B09",
  panelSurface: "#24221E",
  modalSurface: "#211F1B",
  raised: "#2F2C27",
  inset: "#161512",
  panelBorder: "#4A453B",
  inputEdge: "#8F8470",
  gold: "#C9A227",
  frameShadow: "#5E4A12",
  frameLight: "#EDD27A",
  rivet: "#B89A4A",
  ink: "#F2EBDC",
  inkMuted: "#BDB3A0",
  heading: "#F2C200",
  plate: "#12110E",
  plateInk: "#F2C200",
  plateText: "#F2EBDC",
  blue: "#4FD8CB",
  onBlue: "#0E1A19",
  selected: "#3A3320",
  hover: "#36322B",
  green: "#62D98C",
  crimson: "#FF7A86",
  amber: "#F7B33C",
  orangeRed: "#F58A4E",
  cyan: "#4FD8CB",
  navy: "#E0C25A",
  primaryTop: "#FFD83A",
  primaryBottom: "#E2B400",
  primaryInk: "#1A1610",
  primaryEdge: "#6E5600",
  dangerTop: "#D3304A",
  dangerBottom: "#B51F33",
  dangerInk: "#FFFFFF",
  dangerEdge: "#5E0E19",
  steelTop: "#45413A",
  steelBottom: "#2F2C27",
  steelEdge: "#7A6420",
  backdrop: "rgba(8, 7, 5, 0.62)",
};

export const lightScheme: UiScheme = {
  page: "#D8D0BE",
  pageEdge: "#A89E88",
  panelSurface: "#EEE7D5",
  modalSurface: "#F3EDDF",
  raised: "#FBF8F0",
  inset: "#E0D8C4",
  panelBorder: "#B7AB90",
  inputEdge: "#7D7259",
  gold: "#97760F",
  frameShadow: "#5E4A12",
  frameLight: "#E8CB62",
  rivet: "#8C7330",
  ink: "#1F1B15",
  inkMuted: "#585041",
  heading: "#1F1B15",
  plate: "#24211C",
  plateInk: "#F2C200",
  plateText: "#F2EBDC",
  blue: "#0A6860",
  onBlue: "#FFFFFF",
  selected: "#F5E3A0",
  hover: "#E4DCC8",
  green: "#1B7336",
  crimson: "#B01A2E",
  amber: "#8F5C00",
  orangeRed: "#A8400E",
  cyan: "#0A6860",
  navy: "#5A4510",
  primaryTop: "#FFD83A",
  primaryBottom: "#E2B400",
  primaryInk: "#1A1610",
  primaryEdge: "#7A5F00",
  dangerTop: "#CF2F46",
  dangerBottom: "#AE1A2E",
  dangerInk: "#FFFFFF",
  dangerEdge: "#5E0E19",
  steelTop: "#FBF8F0",
  steelBottom: "#DDD4BF",
  steelEdge: "#8C7A4E",
  backdrop: "rgba(20, 17, 12, 0.5)",
};

export const uiSchemes = { light: lightScheme, dark: darkScheme } as const;
export type SchemeName = keyof typeof uiSchemes;

/**
 * Lamp colours for status chips. They are the robots' status-light colours
 * (scene/avatar/statusBulb.ts BULB_COLORS; a test keeps them equal), so a
 * chip in a panel shows the same lamp as the henchman in the world.
 */
export const lampColors = {
  starting: "#9E9E9E",
  idle: "#3DCB6A",
  working: "#1E6FE0",
  waiting: "#F5A623",
  error: "#E53935",
  off: "#2B2B2B",
} as const;
export type LampColor = keyof typeof lampColors;

/** Fonts (Google Fonts, SIL Open Font License 1.1; see packages/assets/ATTRIBUTION.md). */
export const lairFonts = {
  /** Body text: Barlow, a readable grotesk with a hint of industrial signage. */
  ui: '"Barlow", "Segoe UI", system-ui, sans-serif',
  /** Stencil headings and nameplates. */
  stencil: '"Saira Stencil One", "Barlow", "Segoe UI", system-ui, sans-serif',
  /** Readouts: clock, counters, keys. */
  mono: '"Share Tech Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;
