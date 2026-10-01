/**
 * WCAG 2.x contrast for the HUD's token pairs (#189). `CONTRAST_PAIRS` lists
 * every text/background pair the panels use, per scheme, with the ratio it
 * must reach: 4.5 for body text (AA), 3 for large text and for non-text
 * parts such as focus rings, frames and lamps (WCAG 1.4.11).
 */
import { type SchemeName, type UiScheme, uiSchemes } from "./lairPalette.ts";

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of an opaque `#RRGGBB` colour. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`not an opaque #RRGGBB colour: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** Contrast ratio between two opaque colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export const AA_TEXT = 4.5;
export const AA_LARGE_OR_UI = 3;

type Role = keyof UiScheme;
export interface ContrastPair {
  fg: Role;
  bg: Role;
  min: number;
  use: string;
}

const text = (fg: Role, bg: Role, use: string): ContrastPair => ({ fg, bg, min: AA_TEXT, use });
const ui = (fg: Role, bg: Role, use: string): ContrastPair => ({
  fg,
  bg,
  min: AA_LARGE_OR_UI,
  use,
});

/** The main token pairs, checked in both schemes. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...(["panelSurface", "modalSurface", "raised", "inset", "selected", "hover"] as const).flatMap(
    (bg) => [
      text("ink", bg, "body text"),
      text("inkMuted", bg, "hints and secondary text"),
      text("blue", bg, "links and ghost buttons"),
    ],
  ),
  ...(["panelSurface", "modalSurface", "raised"] as const).flatMap((bg) => [
    text("heading", bg, "stencil panel headings"),
    text("green", bg, "positive text (spend, connected)"),
    text("crimson", bg, "errors"),
    text("amber", bg, "warnings"),
    text("orangeRed", bg, "own chat author"),
    text("navy", bg, "author names and rules"),
    ui("blue", bg, "focus ring"),
    ui("gold", bg, "brass frame"),
  ]),
  text("plateInk", "plate", "nameplate titles and lamp chips"),
  text("plateText", "plate", "lamp chip labels"),
  text("onBlue", "blue", "text on an accent fill"),
  text("primaryInk", "primaryTop", "primary button label (top)"),
  text("primaryInk", "primaryBottom", "primary button label (bottom)"),
  text("dangerInk", "dangerTop", "destructive button label (top)"),
  text("dangerInk", "dangerBottom", "destructive button label (bottom)"),
  text("ink", "steelTop", "secondary button label (top)"),
  text("ink", "steelBottom", "secondary button label (bottom)"),
  ui("inputEdge", "panelSurface", "input edge on a panel"),
  ui("inputEdge", "modalSurface", "input edge on a dialog"),
  ui("inputEdge", "inset", "input edge around its well"),
];

export interface ContrastResult extends ContrastPair {
  scheme: SchemeName;
  ratio: number;
  pass: boolean;
}

/** Every pair in every scheme, with its ratio. */
export function contrastReport(): ContrastResult[] {
  return (Object.keys(uiSchemes) as SchemeName[]).flatMap((scheme) =>
    CONTRAST_PAIRS.map((p) => {
      const s = uiSchemes[scheme];
      const ratio = contrastRatio(s[p.fg], s[p.bg]);
      return { ...p, scheme, ratio, pass: ratio >= p.min };
    }),
  );
}
