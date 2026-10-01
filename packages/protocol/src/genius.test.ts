import { describe, expect, test } from "bun:test";
import { GeniusLook } from "./building-state.ts";
import {
  ARCHETYPE_DEFAULTS,
  accessoriesFor,
  checkGeniusLook,
  DEFAULT_GENIUS_LOOK,
  GENIUS_ACCESSORIES,
  GENIUS_ARCHETYPES,
  resolveGeniusLook,
} from "./genius.ts";

describe("genius catalogue", () => {
  test("six archetypes, each with two or three accessories plus none", () => {
    expect(GENIUS_ARCHETYPES).toHaveLength(6);
    for (const archetype of GENIUS_ARCHETYPES) {
      const own = GENIUS_ACCESSORIES[archetype];
      expect(own.length).toBeGreaterThanOrEqual(2);
      expect(own.length).toBeLessThanOrEqual(3);
      expect(accessoriesFor(archetype)[0]).toBe("none");
    }
  });

  test("the default look and every archetype's starting look are valid", () => {
    expect(checkGeniusLook(DEFAULT_GENIUS_LOOK)).toEqual({ ok: true, look: DEFAULT_GENIUS_LOOK });
    for (const start of Object.values(ARCHETYPE_DEFAULTS)) {
      const look = { ...DEFAULT_GENIUS_LOOK, ...start };
      expect(checkGeniusLook(look).ok).toBe(true);
      expect(GeniusLook.safeParse(look).success).toBe(true);
    }
  });
});

describe("checkGeniusLook", () => {
  test("names every bad field and drops extra keys", () => {
    expect(checkGeniusLook(null)).toEqual({
      ok: false,
      fields: ["archetype", "outfit", "trim", "skin", "hair", "accessory"],
    });
    const look = { ...DEFAULT_GENIUS_LOOK, accessory: "cape" as const };
    expect(checkGeniusLook({ ...look, extra: 1 })).toEqual({ ok: true, look });
    expect(checkGeniusLook({ ...look, accessory: "tiara" })).toEqual({
      ok: false,
      fields: ["accessory"],
    });
    // Prototype keys are not palette entries.
    expect(checkGeniusLook({ ...look, outfit: "toString" })).toEqual({
      ok: false,
      fields: ["outfit"],
    });
  });

  test("the zod shape agrees, including the accessory/archetype rule", () => {
    expect(GeniusLook.safeParse({ ...DEFAULT_GENIUS_LOOK, accessory: "tiara" }).success).toBe(
      false,
    );
    expect(GeniusLook.safeParse({ ...DEFAULT_GENIUS_LOOK, outfit: "pink" }).success).toBe(false);
  });
});

describe("resolveGeniusLook", () => {
  test("falls back field by field so rendering never breaks", () => {
    expect(resolveGeniusLook(undefined)).toEqual(DEFAULT_GENIUS_LOOK);
    expect(
      resolveGeniusLook({ archetype: "diva", outfit: "teal", hair: "pink", accessory: "cape" }),
    ).toEqual({ ...DEFAULT_GENIUS_LOOK, archetype: "diva", outfit: "teal", accessory: "none" });
  });
});
