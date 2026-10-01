import { describe, expect, test } from "bun:test";
import { LOBBY_PALETTE_ID, PALETTES, paletteById, paletteForOperation } from "./palettes.ts";
import { PaletteSchema } from "./types.ts";

describe("palettes", () => {
  test("exports the three GDT-style palettes in cycle order", () => {
    expect(PALETTES.map((p) => p.id)).toEqual(["teal-cream", "oak-sky", "lime-mustard"]);
  });

  test("every palette passes the schema and ids are unique", () => {
    for (const p of PALETTES) expect(PaletteSchema.safeParse(p).success).toBe(true);
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
  });

  test("operations cycle through the list and wrap", () => {
    const ids = [0, 1, 2, 3, 4, 5].map((i) => paletteForOperation(i).id);
    expect(ids).toEqual([
      "teal-cream",
      "oak-sky",
      "lime-mustard",
      "teal-cream",
      "oak-sky",
      "lime-mustard",
    ]);
    expect(paletteForOperation(-1).id).toBe("lime-mustard");
    expect(paletteForOperation(7.9).id).toBe(paletteForOperation(7).id);
  });

  test("consecutive operations never share a palette", () => {
    for (let i = 0; i < 10; i++) {
      expect(paletteForOperation(i).id).not.toBe(paletteForOperation(i + 1).id);
    }
  });

  test("lobby palette exists and lookup by id works", () => {
    expect(paletteById(LOBBY_PALETTE_ID)?.id).toBe(LOBBY_PALETTE_ID);
    expect(paletteById("nope")).toBeUndefined();
  });
});
