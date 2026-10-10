/**
 * Where speech becomes text (#260). Dictation talks to this interface only, so
 * the place the audio goes is one small, swappable module:
 *
 * - `local`: the browser transcribes on this computer (webSpeech.ts, the Web
 *   Speech API with `processLocally`). No audio leaves the machine. The default.
 * - `vendor`: the browser's own online speech service. The audio goes to the
 *   company that makes the browser. Never used unless the person chose it.
 *
 * A later engine (a model run in the page, or one on the office's own server)
 * implements the same interface and is added to `DictationEngines`.
 */

export type DictationEngineId = "local" | "vendor";

/** Can this engine transcribe `lang` right now? */
export type EngineAvailability =
  /** Yes. */
  | "ready"
  /** After a one-time download the person starts (`prepare`). */
  | "needs-download"
  | "downloading"
  /** Not in this browser or not for this language. */
  | "unavailable";

export type DictationErrorCode =
  /** The person or the browser's settings refused the microphone. */
  | "mic-blocked"
  /** No microphone found. */
  | "no-mic"
  /** The online service could not be reached (vendor engine). */
  | "network"
  /** The engine cannot transcribe this language. */
  | "language"
  | "failed";

export interface DictationHandlers {
  /** The microphone is open and the engine is listening. */
  onStart(): void;
  /** What the engine thinks was said so far in the phrase still being spoken. */
  onInterim(text: string): void;
  /** A finished phrase. */
  onFinal(text: string): void;
  onError(code: DictationErrorCode): void;
  /** The microphone is closed; nothing more will come. Always the last call. */
  onEnd(): void;
}

export interface DictationSession {
  /** Stop listening and deliver what was heard (`onFinal`, then `onEnd`). */
  stop(): void;
  /** Stop listening and drop what was heard. */
  abort(): void;
}

export interface DictationEngine {
  readonly id: DictationEngineId;
  /** False when this browser has no such engine at all. */
  supported(): boolean;
  availability(lang: string): Promise<EngineAvailability>;
  /** Start the one-time download; resolves true once the engine is ready. */
  prepare(lang: string): Promise<boolean>;
  /** Opens the microphone: the browser asks for it the first time. */
  start(lang: string, handlers: DictationHandlers): DictationSession;
}

export type DictationEngines = Readonly<Record<DictationEngineId, DictationEngine>>;

/** In plain words, where the audio goes: shown before first use and in Settings. */
export const ENGINE_AUDIO: Readonly<Record<DictationEngineId, string>> = {
  local:
    "Your browser turns your speech into text on this computer. No audio is sent to the office or to anyone else.",
  vendor:
    "Your browser's online speech service: the audio of what you dictate is sent to the company that makes your browser (Google for Chrome, Microsoft for Edge, Apple for Safari), under their terms. The office never receives it.",
};
