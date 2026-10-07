/**
 * Client settings persisted in localStorage (SPEC §11: reduced-motion
 * setting disables bubbles/confetti). `null` for reducedMotion means "follow
 * the OS preference". First-person FOV and mouse sensitivity (#144) are
 * clamped to the ranges in scene/camera/perspective.ts.
 */
import {
  clampFovSetting,
  clampMouseSensitivity,
  DEFAULT_FPV_FOV,
  DEFAULT_MOUSE_SENSITIVITY,
} from "../../scene/camera/perspective.ts";

/** Graphics quality (#190): a preset, or "auto" (picked from the GPU; scene/compound/quality.ts). */
export const GRAPHICS_SETTINGS = ["auto", "low", "medium", "high"] as const;
export type GraphicsSetting = (typeof GRAPHICS_SETTINGS)[number];

export interface UiSettings {
  /** null = follow prefers-reduced-motion. */
  reducedMotion: boolean | null;
  /** Office volume 0..1: the jukebox, ambience, klaxon, gong and dings. */
  volume: number;
  /** Personal mute of the lobby jukebox (#47); other sounds keep playing. */
  jukeboxMuted: boolean;
  /** 12-hour clock in the top bar. */
  hour12: boolean;
  /** First-person vertical field of view, degrees. */
  fpvFov: number;
  /** First-person mouse-look sensitivity multiplier (1 = default). */
  mouseSensitivity: number;
  /** Graphics quality preset. */
  graphics: GraphicsSetting;
  /** Proximity voice level 0..1 on top of `volume` (#48). */
  voiceVolume: number;
  /** Push-to-talk: the mic is live only while M is held (#48). */
  pushToTalk: boolean;
  /** Microphone to use; "" = the browser's default (#48). */
  micDeviceId: string;
  /**
   * Bubbles over henchmen that say what they are doing (#256). Off hides those;
   * "needs you" and "answer ready" bubbles always show.
   */
  activityBubbles: boolean;
}

export const SETTINGS_STORAGE_KEY = "regulus.ui.settings.v1";

export const DEFAULT_SETTINGS: Readonly<UiSettings> = {
  reducedMotion: null,
  volume: 0.8,
  jukeboxMuted: false,
  hour12: false,
  fpvFov: DEFAULT_FPV_FOV,
  mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY,
  graphics: "auto",
  voiceVolume: 1,
  pushToTalk: false,
  micDeviceId: "",
  activityBubbles: true,
};

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/** Parse a stored JSON blob leniently; unknown or malformed fields fall back to defaults. */
export function parseSettings(raw: string | null | undefined): UiSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (!data || typeof data !== "object") return { ...DEFAULT_SETTINGS };
  const o = data as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const volume = num(o.volume);
  const fpvFov = num(o.fpvFov);
  const sensitivity = num(o.mouseSensitivity);
  const voiceVolume = num(o.voiceVolume);
  return {
    reducedMotion: typeof o.reducedMotion === "boolean" ? o.reducedMotion : null,
    volume: volume === null ? DEFAULT_SETTINGS.volume : Math.min(1, Math.max(0, volume)),
    jukeboxMuted:
      typeof o.jukeboxMuted === "boolean" ? o.jukeboxMuted : DEFAULT_SETTINGS.jukeboxMuted,
    hour12: typeof o.hour12 === "boolean" ? o.hour12 : DEFAULT_SETTINGS.hour12,
    fpvFov: fpvFov === null ? DEFAULT_SETTINGS.fpvFov : clampFovSetting(fpvFov),
    mouseSensitivity:
      sensitivity === null ? DEFAULT_SETTINGS.mouseSensitivity : clampMouseSensitivity(sensitivity),
    graphics: (GRAPHICS_SETTINGS as readonly unknown[]).includes(o.graphics)
      ? (o.graphics as GraphicsSetting)
      : DEFAULT_SETTINGS.graphics,
    voiceVolume:
      voiceVolume === null ? DEFAULT_SETTINGS.voiceVolume : Math.min(1, Math.max(0, voiceVolume)),
    pushToTalk: typeof o.pushToTalk === "boolean" ? o.pushToTalk : DEFAULT_SETTINGS.pushToTalk,
    micDeviceId:
      typeof o.micDeviceId === "string" && o.micDeviceId.length <= 256
        ? o.micDeviceId
        : DEFAULT_SETTINGS.micDeviceId,
    activityBubbles:
      typeof o.activityBubbles === "boolean" ? o.activityBubbles : DEFAULT_SETTINGS.activityBubbles,
  };
}

export function serializeSettings(settings: UiSettings): string {
  return JSON.stringify(settings);
}

export function loadSettings(storage: StorageLike | null | undefined): UiSettings {
  try {
    return parseSettings(storage?.getItem(SETTINGS_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(storage: StorageLike | null | undefined, settings: UiSettings): void {
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, serializeSettings(settings));
  } catch {
    // Private mode / quota: settings just do not persist.
  }
}

/** The effective reduced-motion flag given the stored override and the OS preference. */
export function effectiveReducedMotion(settings: UiSettings, osPrefers: boolean): boolean {
  return settings.reducedMotion ?? osPrefers;
}

export function browserLocalStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
