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

export function speechErrorCode(error: string): DictationErrorCode | null {
  switch (error) {
    // Silence and our own abort are not problems worth telling.
    case "no-speech":
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
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
  /** The on-device API, or null: without it `processLocally` would be silently ignored. */
  const onDevice = () => {
    const ctor = lookup();
    return ctor && typeof ctor.available === "function" ? ctor : null;
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
  if (local) rec.processLocally = true;
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
    const code = speechErrorCode(event.error);
    if (code && !ended) handlers.onError(code);
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
