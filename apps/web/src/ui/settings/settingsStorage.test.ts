import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SETTINGS,
  effectiveReducedMotion,
  loadSettings,
  parseSettings,
  SETTINGS_STORAGE_KEY,
  type StorageLike,
  saveSettings,
  serializeSettings,
} from "./settingsStorage.ts";

const memoryStorage = (): StorageLike & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
};

describe("settings storage", () => {
  test("missing or broken data yields defaults", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("42")).toEqual(DEFAULT_SETTINGS);
  });

  test("fields are validated individually and volume is clamped", () => {
    expect(parseSettings('{"reducedMotion":true,"volume":7,"hour12":"yes"}')).toEqual({
      reducedMotion: true,
      volume: 1,
      hour12: false,
    });
    expect(parseSettings('{"reducedMotion":"no","volume":-1}')).toEqual({
      reducedMotion: null,
      volume: 0,
      hour12: false,
    });
  });

  test("round-trips through a storage", () => {
    const storage = memoryStorage();
    const settings = { reducedMotion: false, volume: 0.25, hour12: true };
    saveSettings(storage, settings);
    expect(storage.map.get(SETTINGS_STORAGE_KEY)).toBe(serializeSettings(settings));
    expect(loadSettings(storage)).toEqual(settings);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  test("storage failures are swallowed", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(broken, DEFAULT_SETTINGS)).not.toThrow();
  });

  test("reduced motion follows the OS unless overridden", () => {
    expect(effectiveReducedMotion({ ...DEFAULT_SETTINGS, reducedMotion: null }, true)).toBe(true);
    expect(effectiveReducedMotion({ ...DEFAULT_SETTINGS, reducedMotion: null }, false)).toBe(false);
    expect(effectiveReducedMotion({ ...DEFAULT_SETTINGS, reducedMotion: false }, true)).toBe(false);
    expect(effectiveReducedMotion({ ...DEFAULT_SETTINGS, reducedMotion: true }, false)).toBe(true);
  });
});
