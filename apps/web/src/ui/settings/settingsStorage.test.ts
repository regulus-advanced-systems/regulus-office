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
      jukeboxMuted: false,
      hour12: false,
      fpvFov: DEFAULT_SETTINGS.fpvFov,
      mouseSensitivity: DEFAULT_SETTINGS.mouseSensitivity,
      graphics: "auto",
      voiceVolume: 1,
      pushToTalk: false,
      micDeviceId: "",
    });
    expect(parseSettings('{"reducedMotion":"no","volume":-1}')).toEqual({
      reducedMotion: null,
      volume: 0,
      jukeboxMuted: false,
      hour12: false,
      fpvFov: DEFAULT_SETTINGS.fpvFov,
      mouseSensitivity: DEFAULT_SETTINGS.mouseSensitivity,
      graphics: "auto",
      voiceVolume: 1,
      pushToTalk: false,
      micDeviceId: "",
    });
  });

  test("voice settings default, persist and clamp (#48)", () => {
    expect(parseSettings('{"volume":0.5}')).toMatchObject({
      voiceVolume: 1,
      pushToTalk: false,
      micDeviceId: "",
    });
    expect(parseSettings('{"voiceVolume":3,"pushToTalk":"on","micDeviceId":7}')).toMatchObject({
      voiceVolume: 1,
      pushToTalk: false,
      micDeviceId: "",
    });
    expect(
      parseSettings('{"voiceVolume":0.3,"pushToTalk":true,"micDeviceId":"abc"}'),
    ).toMatchObject({ voiceVolume: 0.3, pushToTalk: true, micDeviceId: "abc" });
  });

  test("first-person FOV and mouse sensitivity default, persist and clamp", () => {
    expect(DEFAULT_SETTINGS.fpvFov).toBe(60);
    expect(DEFAULT_SETTINGS.mouseSensitivity).toBe(1);
    // Settings saved before #144 have neither field.
    const old = parseSettings('{"reducedMotion":true,"volume":0.5,"hour12":true}');
    expect(old.fpvFov).toBe(60);
    expect(old.mouseSensitivity).toBe(1);
    const wild = parseSettings('{"fpvFov":170,"mouseSensitivity":-3}');
    expect(wild.fpvFov).toBe(75);
    expect(wild.mouseSensitivity).toBe(0.25);
    const bad = parseSettings('{"fpvFov":"wide","mouseSensitivity":null}');
    expect(bad.fpvFov).toBe(60);
    expect(bad.mouseSensitivity).toBe(1);
    expect(parseSettings('{"fpvFov":66,"mouseSensitivity":2}')).toMatchObject({
      fpvFov: 66,
      mouseSensitivity: 2,
    });
  });

  test("graphics quality defaults to auto and keeps only known presets (#190)", () => {
    expect(DEFAULT_SETTINGS.graphics).toBe("auto");
    expect(parseSettings('{"graphics":"low"}').graphics).toBe("low");
    expect(parseSettings('{"graphics":"ultra"}').graphics).toBe("auto");
    expect(parseSettings('{"volume":0.5}').graphics).toBe("auto");
  });

  test("round-trips through a storage", () => {
    const storage = memoryStorage();
    const settings = {
      reducedMotion: false,
      volume: 0.25,
      jukeboxMuted: true,
      hour12: true,
      fpvFov: 68,
      mouseSensitivity: 1.5,
      graphics: "medium" as const,
      voiceVolume: 0.5,
      pushToTalk: true,
      micDeviceId: "mic-2",
    };
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
