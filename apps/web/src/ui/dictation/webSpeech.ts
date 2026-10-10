/**
 * The two engines the browser brings (#260), both through the Web Speech API:
 *
 * - `local` sets `processLocally`, which makes the browser transcribe on the
 *   device and fail rather than fall back to its online service. A browser
 *   without the on-device API (no static `available`) would ignore that flag
 *   and send the audio out, so there `local` reports "unavailable" and never
 *   starts.
 * - `vendor` leaves the flag off: the browser sends the audio to its maker's
 *   service. Only started when the person chose it (controller.ts).
 *
 * The constructor is looked up at each use, so a page (or a test) that
 * provides one later is picked up.
 *
 * The on-device API, checked against its sources (2026-10-10), not memory:
 *
 * - Spec, https://webaudio.github.io/web-speech-api/ : `attribute boolean
 *   processLocally` ("when set to true, indicates a requirement that the speech
 *   recognition process MUST be performed locally on the user's device");
 *   `static Promise<AvailabilityStatus> available(SpeechRecognitionOptions)` and
 *   `static Promise<boolean> install(SpeechRecognitionOptions)`, with
 *   `{ required sequence<DOMString> langs; boolean processLocally = false;
 *   SpeechRecognitionQuality quality = "command" }` and AvailabilityStatus
 *   "unavailable" | "downloadable" | "downloading" | "available". Its start
 *   algorithm: with `processLocally` true and no local recognition for `lang`,
 *   fire `error` with "service-not-allowed" and abort. There is no fallback.
 * - MDN, https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally ,
 *   .../available_static , .../install_static and
 *   https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API#on-device_speech_recognition :
 *   same names and values; "if you run the start() method after specifying
 *   processLocally = true but the correct language pack isn't installed, the
 *   function call will fail with a language-not-supported error". Both methods
 *   sit behind the `on-device-speech-recognition` Permissions-Policy (default
 *   `self`; the office sets no such header).
 * - Shipped in Chrome 139 on desktop, not Android; Edge follows Chrome; not in
 *   Safari; Firefox preview only (MDN browser-compat-data,
 *   api/SpeechRecognition.json; https://developer.chrome.com/release-notes/139
 *   "On-device Web Speech API ... allowing websites to ensure that neither audio
 *   nor transcribed speech are sent to a third-party service").
 * - Chromium, third_party/blink/renderer/modules/speech/speech_recognition.cc:
 *   `start()` with processLocally re-checks the language pack and fires
 *   "language-not-supported" (MDN's name, not the spec's) unless it is
 *   installed, then starts with `allow_cloud_fallback = !process_locally_`.
 *   `install()` resolves false unless `processLocally: true` is passed (the
 *   spec ignores it) and wants a user activation: it is called from the
 *   notice's Download button. Seen in Chromium 153 (tests/e2e/dictationRealApi.e2e.ts):
 *   no pack gives "downloadable", and such a start fires the error and no `end`.
 *
 * So here: both error names mean "not on this computer" for the local engine,
 * every told error ends the session itself, and the local engine starts only
 * on a browser that has the attribute and `available`.
 */
import type {
  DictationEngine,
  DictationEngineId,
  DictationErrorCode,
  DictationHandlers,
  DictationSession,
  EngineAvailability,
} from "./engine.ts";

interface SpeechAlternativeLike {
  transcript: string;
}
interface SpeechResultLike {
  isFinal: boolean;
  0: SpeechAlternativeLike;
}
export interface SpeechResultEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechResultLike>;
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface LocalQuery {
  langs: string[];
  processLocally: true;
}
export interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
  /** On-device API: "unavailable" | "downloadable" | "downloading" | "available". */
  available?: (query: LocalQuery) => Promise<string>;
  /** Chromium resolves false unless `processLocally: true` is passed; needs a user activation. */
  install?: (query: LocalQuery) => Promise<boolean>;
}

export type SpeechCtorLookup = () => SpeechRecognitionCtor | null;

export const browserSpeechCtor: SpeechCtorLookup = () => {
  const g = globalThis as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
};

export function speechErrorCode(error: string, local = false): DictationErrorCode | null {
  switch (error) {
    // Silence and our own abort are not problems worth telling.
    case "no-speech":
    case "aborted":
      return null;
    case "service-not-allowed":
      // The spec's name for "cannot be done on this device" (Chromium says
      // "language-not-supported"); otherwise the browser refusing its service.
      return local ? "language" : "mic-blocked";
    case "not-allowed":
      return "mic-blocked";
    case "audio-capture":
      return "no-mic";
    case "network":
      return "network";
    case "language-not-supported":
      return "language";
    default:
      return "failed";
  }
}

function localAvailability(state: string): EngineAvailability {
  if (state === "available") return "ready";
  if (state === "downloadable") return "needs-download";
  if (state === "downloading") return "downloading";
  return "unavailable";
}

export function createWebSpeechEngine(
  id: DictationEngineId,
  lookup: SpeechCtorLookup = browserSpeechCtor,
): DictationEngine {
  const local = id === "local";
  const query = (lang: string): LocalQuery => ({ langs: [lang], processLocally: true });
  /**
   * The on-device API, or null. A browser without the `processLocally` attribute would
   * take the assignment for a stray property and send the audio to its online service.
   */
  const onDevice = () => {
    const ctor = lookup();
    if (!ctor || typeof ctor.available !== "function") return null;
    return ctor.prototype && "processLocally" in ctor.prototype ? ctor : null;
  };
  const availability = async (lang: string): Promise<EngineAvailability> => {
    if (!local) return lookup() ? "ready" : "unavailable";
    const ctor = onDevice();
    if (!ctor?.available) return "unavailable";
    try {
      return localAvailability(await ctor.available(query(lang)));
    } catch {
      return "unavailable";
    }
  };
  return {
    id,
    supported: () => (local ? onDevice() !== null : lookup() !== null),
    availability,
    prepare: async (lang) => {
      if (!local) return lookup() !== null;
      const ctor = onDevice();
      if (!ctor?.install) return false;
      try {
        return (await ctor.install(query(lang))) === true;
      } catch {
        return false;
      }
    },
    start: (lang, handlers) => startSession(local ? onDevice() : lookup(), local, lang, handlers),
  };
}

function startSession(
  ctor: SpeechRecognitionCtor | null,
  local: boolean,
  lang: string,
  handlers: DictationHandlers,
): DictationSession {
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    handlers.onEnd();
  };
  if (!ctor) {
    handlers.onError("failed");
    end();
    return { stop: () => {}, abort: () => {} };
  }
  const rec = new ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  if (local) {
    rec.processLocally = true;
    // Refuse rather than record if the requirement did not take, or there is no language
    // for the browser to check its on-device pack against.
    if (rec.processLocally !== true || !lang) {
      handlers.onError("language");
      end();
      return { stop: () => {}, abort: () => {} };
    }
  }
  rec.onstart = () => {
    if (!ended) handlers.onStart();
  };
  rec.onresult = (event) => {
    if (ended) return;
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result) continue;
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) handlers.onFinal(text);
      else interim += text;
    }
    handlers.onInterim(interim);
  };
  rec.onerror = (event) => {
    const code = speechErrorCode(event.error, local);
    if (!code || ended) return;
    handlers.onError(code);
    // Chromium fires no `end` after refusing an on-device start: close it ourselves.
    try {
      rec.abort();
    } catch {
      // Never started.
    }
    end();
  };
  rec.onend = end;
  try {
    rec.start();
  } catch {
    handlers.onError("failed");
    end();
  }
  return {
    stop: () => {
      try {
        rec.stop();
      } catch {
        end();
      }
    },
    abort: () => {
      try {
        rec.abort();
      } catch {
        // Already stopped.
      }
      end();
    },
  };
}

export function createBrowserEngines(lookup: SpeechCtorLookup = browserSpeechCtor) {
  return {
    local: createWebSpeechEngine("local", lookup),
    vendor: createWebSpeechEngine("vendor", lookup),
  } as const;
}
