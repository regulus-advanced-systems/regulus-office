/**
 * The lair control-panel theme (#189): AA contrast for the main token pairs
 * in both schemes, lamps that match the henchmen's status lights, and the
 * CSS that switches scheme with the system theme.
 */
import { describe, expect, test } from "bun:test";
import { AGENT_STATUSES } from "@regulus/protocol";
import { BULB_COLORS } from "../../scene/avatar/statusBulb.ts";
import { schemeTokens, themeCssText } from "../theme.ts";
import { AA_TEXT, contrastRatio, contrastReport } from "./contrast.ts";
import { darkScheme, lampColors, lightScheme, uiSchemes } from "./lairPalette.ts";
import { AGENT_LAMPS } from "./lamps.ts";

describe("contrast", () => {
  test("the WCAG formula gives the known extremes", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    // A known AA boundary: #767676 on white is 4.54.
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
  });

  const report = contrastReport();
  for (const r of report) {
    test(`${r.scheme}: ${r.fg} on ${r.bg} (${r.use}) reaches ${r.min}:1`, () => {
      expect(r.ratio).toBeGreaterThanOrEqual(r.min);
    });
  }

  test("covers body text on every face in both schemes", () => {
    for (const scheme of ["light", "dark"] as const) {
      for (const bg of ["panelSurface", "modalSurface", "raised", "inset"] as const) {
        const pair = report.find(
          (r) => r.scheme === scheme && r.fg === "ink" && r.bg === bg && r.min === AA_TEXT,
        );
        expect(pair?.pass).toBe(true);
      }
    }
  });
});

describe("schemes", () => {
  test("both schemes define the same roles, all opaque hex except the backdrop", () => {
    expect(Object.keys(lightScheme).sort()).toEqual(Object.keys(darkScheme).sort());
    for (const scheme of Object.values(uiSchemes)) {
      for (const [role, value] of Object.entries(scheme)) {
        if (role === "backdrop") expect(value).toMatch(/^rgba\(/);
        else expect(value).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  test("the panels are dark at night and light by day", () => {
    expect(contrastRatio(darkScheme.panelSurface, "#000000")).toBeLessThan(2);
    expect(contrastRatio(lightScheme.panelSurface, "#FFFFFF")).toBeLessThan(1.3);
  });

  test("the CSS declares the light scheme by default and the dark one for a dark system theme", () => {
    const css = themeCssText();
    const [base, dark] = css.split("@media (prefers-color-scheme: dark)") as [string, string];
    expect(base).toContain("color-scheme: light dark;");
    expect(base).toContain(`--rg-color-panel-surface: ${lightScheme.panelSurface};`);
    expect(dark).toContain(`--rg-color-panel-surface: ${darkScheme.panelSurface};`);
    // Every scheme role (including the legacy names the feature CSS uses) is declared in both.
    for (const name of Object.keys(schemeTokens(lightScheme))) {
      expect(base).toContain(`--rg-${name}:`);
      expect(dark).toContain(`--rg-${name}:`);
    }
    for (const legacy of ["blue", "navy", "crimson", "gold", "ink-muted", "modal-surface"]) {
      expect(base).toContain(`--rg-color-${legacy}:`);
    }
    expect(base).toContain("--rg-lamp-working:");
    expect(base).toContain("--rg-font-stencil:");
  });
});

describe("lamps", () => {
  test("each robot status lights the lamp of the henchman's status light", () => {
    for (const status of AGENT_STATUSES) {
      expect(lampColors[AGENT_LAMPS[status]].toUpperCase()).toBe(BULB_COLORS[status].toUpperCase());
    }
  });
});
