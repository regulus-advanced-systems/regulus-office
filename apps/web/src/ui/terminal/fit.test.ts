import { describe, expect, test } from "bun:test";
import { TERMINAL_DEFAULT_SIZE } from "@regulus/protocol";
import { clampGrid, fitFontSize } from "./fit.ts";

describe("fit", () => {
  test("watchers scale the font to the fixed grid", () => {
    expect(fitFontSize(13, { cols: 80, rows: 45 }, TERMINAL_DEFAULT_SIZE)).toBe(6.5);
    expect(fitFontSize(13, undefined, TERMINAL_DEFAULT_SIZE)).toBe(13);
  });

  test("a controller takes what fits, within the protocol bounds and its maximum", () => {
    expect(clampGrid({ cols: 93.7, rows: 18.2 }, { cols: 500, rows: 200 })).toEqual({
      cols: 93,
      rows: 18,
    });
    expect(clampGrid({ cols: 240, rows: 70 }, TERMINAL_DEFAULT_SIZE)).toEqual({
      cols: 160,
      rows: 45,
    });
    expect(clampGrid({ cols: 3, rows: 1 }, TERMINAL_DEFAULT_SIZE)).toEqual({ cols: 20, rows: 5 });
    expect(clampGrid(undefined, TERMINAL_DEFAULT_SIZE)).toBeNull();
    expect(clampGrid({ cols: Number.NaN, rows: 10 }, TERMINAL_DEFAULT_SIZE)).toBeNull();
  });
});
