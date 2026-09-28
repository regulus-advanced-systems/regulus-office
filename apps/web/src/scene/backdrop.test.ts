import { expect, test } from "bun:test";
import { CREAM, vignetteBackground } from "./backdrop.ts";

test("vignette is a radial gradient centred on the SPEC cream", () => {
  expect(CREAM).toBe("#FFF6D9");
  const css = vignetteBackground();
  expect(css.startsWith("radial-gradient(")).toBe(true);
  expect(css).toContain("#FFF6D9 0%");
  expect(css).toContain("100%)");
});
