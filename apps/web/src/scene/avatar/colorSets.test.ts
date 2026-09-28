import { describe, expect, test } from "bun:test";
import { PROVIDER_IDS } from "@regulus/protocol";
import {
  accessoryFor,
  COLOR_SET_IDS,
  COLOR_SETS,
  colorForRole,
  colorSetFor,
  DEFAULT_ACCESSORY,
  DEFAULT_COLOR_SET_ID,
  FACE_COLOR,
  materialRoleFor,
  PROVIDER_LIGHT_COLORS,
  providerLightColor,
  resolveLook,
} from "./colorSets.ts";

const HEX = /^#[0-9A-Fa-f]{6}$/;

describe("colorSets", () => {
  test("every set has three valid, distinct colours", () => {
    for (const id of COLOR_SET_IDS) {
      const set = COLOR_SETS[id];
      expect(set).toBeDefined();
      if (!set) continue;
      expect(set.primary).toMatch(HEX);
      expect(set.secondary).toMatch(HEX);
      expect(set.accent).toMatch(HEX);
      expect(new Set([set.primary, set.secondary, set.accent]).size).toBe(3);
    }
  });

  test("unknown or missing ids fall back to defaults", () => {
    expect(colorSetFor("no-such-set")).toBe(colorSetFor(DEFAULT_COLOR_SET_ID));
    expect(colorSetFor(undefined)).toBe(colorSetFor(DEFAULT_COLOR_SET_ID));
    expect(colorSetFor("oak")).toBe(COLOR_SETS.oak as never);
    expect(accessoryFor("visor")).toBe("visor");
    expect(accessoryFor("cap")).toBe("cap");
    expect(accessoryFor("crown")).toBe(DEFAULT_ACCESSORY);
    expect(accessoryFor(undefined)).toBe(DEFAULT_ACCESSORY);
  });

  test("resolveLook applies both fields from a wire AvatarLook", () => {
    const look = resolveLook({ colorSet: "crimson", accessory: "cap" });
    expect(look.colors).toBe(COLOR_SETS.crimson as never);
    expect(look.accessory).toBe("cap");
    expect(resolveLook(undefined).accessory).toBe(DEFAULT_ACCESSORY);
  });

  test("GLB material names map to colour-set roles", () => {
    const set = colorSetFor("teal");
    expect(materialRoleFor("Main")).toBe("primary");
    expect(materialRoleFor("Grey")).toBe("secondary");
    expect(materialRoleFor("Grey.001")).toBe("secondary");
    expect(materialRoleFor("Black")).toBe("dark");
    expect(materialRoleFor("Whatever")).toBe("primary");
    expect(colorForRole("primary", set)).toBe(set.primary);
    expect(colorForRole("secondary", set)).toBe(set.secondary);
    expect(colorForRole("dark", set)).toBe(FACE_COLOR);
  });

  test("every provider has a chest light colour", () => {
    for (const provider of PROVIDER_IDS) {
      expect(PROVIDER_LIGHT_COLORS[provider]).toMatch(HEX);
      expect(providerLightColor(provider)).toBe(PROVIDER_LIGHT_COLORS[provider]);
    }
    expect(providerLightColor(undefined)).toBeUndefined();
  });
});
