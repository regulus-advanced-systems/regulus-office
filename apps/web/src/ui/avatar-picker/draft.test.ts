import { describe, expect, test } from "bun:test";
import { checkGeniusLook, DEFAULT_GENIUS_LOOK } from "@regulus/protocol/src/genius.ts";
import { initialDraft, sameLook, withAccessory, withArchetype, withColor } from "./draft.ts";

describe("picker draft", () => {
  test("starts from the current look, or the default genius", () => {
    expect(initialDraft(undefined)).toEqual(DEFAULT_GENIUS_LOOK);
    const hacker = { ...DEFAULT_GENIUS_LOOK, archetype: "hacker", accessory: "visor" } as const;
    expect(initialDraft(hacker)).toEqual(hacker);
  });

  test("switching archetype keeps colours and takes that archetype's accessory", () => {
    const start = withColor(withColor(DEFAULT_GENIUS_LOOK, "outfit", "teal"), "hair", "white");
    const diva = withArchetype(start, "diva");
    expect(diva).toMatchObject({
      archetype: "diva",
      outfit: "teal",
      hair: "white",
      accessory: "sunglasses",
    });
    expect(checkGeniusLook(diva).ok).toBe(true);
  });

  test("never produces an invalid look", () => {
    expect(withColor(DEFAULT_GENIUS_LOOK, "skin", "green").skin).toBe(DEFAULT_GENIUS_LOOK.skin);
    expect(withAccessory(DEFAULT_GENIUS_LOOK, "tiara")).toBe(DEFAULT_GENIUS_LOOK);
    expect(withAccessory(DEFAULT_GENIUS_LOOK, "eyepatch").accessory).toBe("eyepatch");
    expect(sameLook(DEFAULT_GENIUS_LOOK, { ...DEFAULT_GENIUS_LOOK })).toBe(true);
    expect(sameLook(DEFAULT_GENIUS_LOOK, withAccessory(DEFAULT_GENIUS_LOOK, "cape"))).toBe(false);
  });
});
