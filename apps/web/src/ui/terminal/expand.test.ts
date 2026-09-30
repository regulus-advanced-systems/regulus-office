import { afterEach, describe, expect, test } from "bun:test";
import { useDom } from "../a11y/dom.ts";
import {
  EXPAND_MIN,
  expandedTerminalSize,
  loadExpanded,
  MODAL_CHROME_PX,
  saveExpanded,
} from "./expand.ts";

useDom();

const normal = { width: 980, height: 496 };

describe("expanded terminal size", () => {
  test("about 60 % of a large window", () => {
    expect(expandedTerminalSize({ width: 2560, height: 1440 }, normal, 200)).toEqual({
      width: 1536,
      height: 864,
    });
    expect(expandedTerminalSize({ width: 1920, height: 1080 }, normal, 200)).toEqual({
      width: 1152,
      height: 648,
    });
  });

  test("at least 900×560 and never smaller than the normal size", () => {
    const size = expandedTerminalSize(
      { width: 1600, height: 1000 },
      { width: 700, height: 320 },
      200,
    );
    expect(size).toEqual({ width: 960, height: 600 });
    expect(
      expandedTerminalSize({ width: 1300, height: 900 }, { width: 700, height: 320 }, 200),
    ).toEqual(EXPAND_MIN);
    expect(expandedTerminalSize({ width: 1500, height: 1000 }, normal, 200).width).toBe(980);
  });

  test("capped to the window, with room for the backdrop and the dialog around it", () => {
    const size = expandedTerminalSize({ width: 1000, height: 700 }, normal, 200);
    expect(size.width).toBe(1000 - 48 - MODAL_CHROME_PX);
    expect(size.height).toBe(700 - 48 - 200);
    expect(expandedTerminalSize({ width: 100, height: 100 }, normal, 200)).toEqual({
      width: 0,
      height: 0,
    });
  });
});

describe("remembered per user", () => {
  afterEach(() => localStorage.clear());
  test("saved and loaded per user id", () => {
    expect(loadExpanded("u1")).toBe(false);
    saveExpanded("u1", true);
    expect(loadExpanded("u1")).toBe(true);
    expect(loadExpanded("u2")).toBe(false);
    saveExpanded("u1", false);
    expect(loadExpanded("u1")).toBe(false);
  });
});
