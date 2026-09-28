/**
 * Client settings persisted in localStorage (SPEC §11: reduced-motion
 * setting disables bubbles/confetti). `null` for reducedMotion means "follow
 * the OS preference".
 */

export interface UiSettings {
  /** null = follow prefers-reduced-motion. */
  reducedMotion: boolean | null;
  /** Master volume placeholder 0..1; the jukebox/ambience work wires it up. */
  volume: number;
  /** 12-hour clock in the top bar. */
  hour12: boolean;
}

export const SETTINGS_STORAGE_KEY = "regulus.ui.settings.v1";

export const DEFAULT_SETTINGS: Readonly<UiSettings> = {
  reducedMotion: null,
  volume: 0.8,
  hour12: false,
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
  const volume = typeof o.volume === "number" && Number.isFinite(o.volume) ? o.volume : null;
  return {
    reducedMotion: typeof o.reducedMotion === "boolean" ? o.reducedMotion : null,
    volume: volume === null ? DEFAULT_SETTINGS.volume : Math.min(1, Math.max(0, volume)),
    hour12: typeof o.hour12 === "boolean" ? o.hour12 : DEFAULT_SETTINGS.hour12,
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
