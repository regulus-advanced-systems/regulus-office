/**
 * Dictation state on this page (#260): what the indicator shows, and the
 * person's choices, kept per browser in localStorage (its own key, so a
 * choice about where audio goes never rides along with other settings).
 */
import { create } from "zustand";
import { browserLocalStorage, type StorageLike } from "../settings/settingsStorage.ts";
import type { DictationEngineId } from "./engine.ts";

export interface DictationPrefs {
  /** Off: the key is left alone everywhere and no mic button shows. */
  enabled: boolean;
  /** "vendor" only ever by the person's own choice. */
  engine: DictationEngineId;
  /** BCP 47 tag; "" follows the browser's language. */
  lang: string;
  /** The person has read where the audio goes. */
  introSeen: boolean;
}

export const DICTATION_STORAGE_KEY = "regulus.dictation.v1";

export const DEFAULT_DICTATION_PREFS: Readonly<DictationPrefs> = {
  enabled: true,
  engine: "local",
  lang: "",
  introSeen: false,
};

/** Languages offered in Settings; "" (the browser's own) comes first there. */
export const DICTATION_LANGUAGES: ReadonlyArray<readonly [tag: string, name: string]> = [
  ["en-US", "English (US)"],
  ["en-GB", "English (UK)"],
  ["de-DE", "German"],
  ["fr-FR", "French"],
  ["es-ES", "Spanish"],
  ["it-IT", "Italian"],
  ["pt-BR", "Portuguese (Brazil)"],
  ["nl-NL", "Dutch"],
  ["pl-PL", "Polish"],
  ["hr-HR", "Croatian"],
  ["ja-JP", "Japanese"],
];

/** Lenient: anything unknown or malformed falls back to the private defaults. */
export function parseDictationPrefs(raw: string | null | undefined): DictationPrefs {
  if (!raw) return { ...DEFAULT_DICTATION_PREFS };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_DICTATION_PREFS };
  }
  if (!data || typeof data !== "object") return { ...DEFAULT_DICTATION_PREFS };
  const o = data as Record<string, unknown>;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : DEFAULT_DICTATION_PREFS.enabled,
    engine: o.engine === "vendor" ? "vendor" : "local",
    lang:
      typeof o.lang === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(o.lang)
        ? o.lang
        : "",
    introSeen: o.introSeen === true,
  };
}

export type DictationPhase =
  | "idle"
  /** Asked the engine to start; the browser may be asking for the microphone. */
  | "starting"
  | "listening"
  /** Key released; waiting for the last phrase. */
  | "finishing";

export type DictationNotice =
  /** First use: where the audio goes, before anything is recorded. */
  | { kind: "intro" }
  /** On-device transcription needs the browser's one-time language download. */
  | { kind: "download" }
  | { kind: "downloading" }
  | { kind: "downloaded" }
  /** This browser cannot transcribe on the device; the online service is the person's call. */
  | { kind: "local-unavailable" }
  /** No speech recognition in this browser at all. */
  | { kind: "unsupported" }
  | { kind: "watch-only" }
  | { kind: "error"; message: string };

export interface DictationStore {
  prefs: DictationPrefs;
  phase: DictationPhase;
  /** The phrase being spoken, as heard so far. */
  interim: string;
  /** The open voice-chat mic was muted for this dictation. */
  voicePaused: boolean;
  notice: DictationNotice | null;
  /** The element being dictated into (indicator position). */
  recordingAt: HTMLElement | null;
  updatePrefs(patch: Partial<DictationPrefs>): void;
  set(
    patch: Partial<Pick<DictationStore, "phase" | "interim" | "voicePaused" | "recordingAt">>,
  ): void;
  setNotice(notice: DictationNotice | null): void;
}

export function createDictationStore(
  storage: StorageLike | null | undefined = browserLocalStorage(),
) {
  const load = (): DictationPrefs => {
    try {
      return parseDictationPrefs(storage?.getItem(DICTATION_STORAGE_KEY));
    } catch {
      return { ...DEFAULT_DICTATION_PREFS };
    }
  };
  return create<DictationStore>()((set, get) => ({
    prefs: load(),
    phase: "idle",
    interim: "",
    voicePaused: false,
    notice: null,
    recordingAt: null,
    updatePrefs: (patch) => {
      const prefs = { ...get().prefs, ...patch };
      try {
        storage?.setItem(DICTATION_STORAGE_KEY, JSON.stringify(prefs));
      } catch {
        // Private mode: the choice lasts for this page only.
      }
      set({ prefs });
    },
    set: (patch) => set(patch),
    setNotice: (notice) => set({ notice }),
  }));
}

export type DictationStoreApi = ReturnType<typeof createDictationStore>;

export const useDictationStore = createDictationStore();
