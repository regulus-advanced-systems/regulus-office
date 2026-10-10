/**
 * Hold to dictate (#260): what a press and a release of the key (or the mic
 * button) do. No DOM here; useDictation.ts feeds it the keyboard.
 *
 * - A press starts listening only when the focused thing takes text
 *   (targets.ts) and the chosen engine can run. With the default engine no
 *   audio leaves the computer; the online one is only ever the person's own
 *   choice (`useVendor`, from a notice that says where the audio goes).
 * - The first press ever records nothing: it says where the audio goes.
 * - A release always stops: before the engine is listening it aborts, after
 *   that it stops and waits a moment for the last phrase, then aborts.
 * - Finished phrases are typed into the target as plain text. Enter is never
 *   sent.
 */
import {
  type DictationNotice,
  type DictationStoreApi,
  useDictationStore,
} from "./dictationStore.ts";
import type {
  DictationEngine,
  DictationEngines,
  DictationErrorCode,
  DictationSession,
} from "./engine.ts";
import { cleanTranscript, type DictationTarget, type TargetLookup } from "./targets.ts";

/** How long a release waits for the engine's last phrase before cutting it off. */
export const FINISH_TIMEOUT_MS = 3000;
/** How long a passing notice (an error, "watching only") stays up. */
export const NOTICE_MS = 7000;

export const ERROR_TEXT: Readonly<Record<DictationErrorCode, string>> = {
  "mic-blocked":
    "The microphone is blocked for this site. Allow it in your browser's site settings, then try again.",
  "no-mic": "No microphone was found.",
  network: "Your browser's speech service could not be reached.",
  language:
    "Your browser cannot transcribe this language. Pick another under Settings, Display and sound, Dictation.",
  failed: "Dictation stopped unexpectedly. Try again.",
};

const PASSING: ReadonlySet<DictationNotice["kind"]> = new Set([
  "watch-only",
  "error",
  "downloaded",
]);

export interface DictationControllerDeps {
  engines: DictationEngines;
  store?: DictationStoreApi;
  /** The browser's language, used when the person picked none. */
  browserLang?: () => string;
  /** Mute an open voice-chat mic while dictating; returns how to put it back, or null. */
  pauseVoice?: () => (() => void) | null;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class DictationController {
  private readonly engines: DictationEngines;
  private readonly store: DictationStoreApi;
  private readonly deps: DictationControllerDeps;
  private held = false;
  /** Bumped by every press and release, so a slow check from an old press drops out. */
  private press = 0;
  private session: DictationSession | null = null;
  private resumeVoice: (() => void) | null = null;
  private finishTimer: unknown = null;
  private noticeTimer: unknown = null;

  constructor(deps: DictationControllerDeps) {
    this.deps = deps;
    this.engines = deps.engines;
    this.store = deps.store ?? useDictationStore;
  }

  private get state() {
    return this.store.getState();
  }

  lang(): string {
    return this.state.prefs.lang || this.deps.browserLang?.() || "en-US";
  }

  /** Whether dictation takes this press at all; if not, the key is the page's. */
  takes(lookup: TargetLookup): lookup is NonNullable<TargetLookup> {
    return lookup !== null && this.state.prefs.enabled;
  }

  /** The key or the mic button went down. Returns whether dictation took it. */
  begin(lookup: TargetLookup): boolean {
    if (!this.takes(lookup)) return false;
    if (this.held) return true;
    if ("blocked" in lookup) {
      this.notify({ kind: "watch-only" });
      return true;
    }
    // Still delivering the last phrase of the hold before.
    if (this.state.phase !== "idle") return true;
    this.held = true;
    const press = ++this.press;
    void this.open(press, lookup.target);
    return true;
  }

  private async open(press: number, target: DictationTarget): Promise<void> {
    const { prefs, notice } = this.state;
    if (!this.engines.vendor.supported()) return this.notify({ kind: "unsupported" });
    const engine = this.engines[prefs.engine];
    const lang = this.lang();
    if (engine.id === "local") {
      const availability = await engine.availability(lang);
      if (press !== this.press) return;
      if (availability === "unavailable") return this.notify({ kind: "local-unavailable" });
      if (availability === "needs-download") return this.notify({ kind: "download" });
      if (availability === "downloading") return this.notify({ kind: "downloading" });
      if (!prefs.introSeen) {
        // A second press with the notice up has read it.
        if (notice?.kind !== "intro") return this.notify({ kind: "intro" });
        this.state.updatePrefs({ introSeen: true });
      }
    }
    this.start(engine, lang, target);
  }

  private start(engine: DictationEngine, lang: string, target: DictationTarget): void {
    this.notify(null);
    this.resumeVoice = this.deps.pauseVoice?.() ?? null;
    this.state.set({
      phase: "starting",
      interim: "",
      recordingAt: target.element,
      voicePaused: this.resumeVoice !== null,
    });
    let ended = false;
    const session = engine.start(lang, {
      onStart: () => {
        if (!ended && this.state.phase === "starting") this.state.set({ phase: "listening" });
      },
      onInterim: (text) => {
        if (!ended) this.state.set({ interim: cleanTranscript(text) });
      },
      onFinal: (text) => {
        if (ended) return;
        this.state.set({ interim: "" });
        if (target.alive()) target.insert(text);
      },
      onError: (code) => {
        if (!ended) this.notify({ kind: "error", message: ERROR_TEXT[code] });
      },
      onEnd: () => {
        if (ended) return;
        ended = true;
        this.finished();
      },
    });
    if (ended) return;
    this.session = session;
    // Released while the engine was being started.
    if (!this.held) session.abort();
  }

  private finished(): void {
    if (this.finishTimer !== null)
      (this.deps.clearTimer ?? clearTimeout)(this.finishTimer as never);
    this.finishTimer = null;
    this.session = null;
    this.held = false;
    this.resumeVoice?.();
    this.resumeVoice = null;
    this.state.set({ phase: "idle", interim: "", recordingAt: null, voicePaused: false });
  }

  /** The key or the mic button came up: always stops. */
  release(): void {
    if (!this.held) return;
    this.held = false;
    this.press += 1;
    const session = this.session;
    if (!session) return;
    if (this.state.phase === "starting") return session.abort();
    this.state.set({ phase: "finishing" });
    session.stop();
    this.finishTimer = (this.deps.setTimer ?? setTimeout)(() => {
      this.finishTimer = null;
      this.session?.abort();
    }, FINISH_TIMEOUT_MS);
  }

  /** Stop at once and drop what was not typed yet (the page went away). */
  cancel(): void {
    this.held = false;
    this.press += 1;
    this.session?.abort();
  }

  private notify(notice: DictationNotice | null): void {
    if (this.noticeTimer !== null)
      (this.deps.clearTimer ?? clearTimeout)(this.noticeTimer as never);
    this.noticeTimer = null;
    this.state.setNotice(notice);
    if (notice && PASSING.has(notice.kind)) {
      this.noticeTimer = (this.deps.setTimer ?? setTimeout)(() => {
        this.noticeTimer = null;
        this.state.setNotice(null);
      }, NOTICE_MS);
    }
  }

  dismissNotice(): void {
    this.notify(null);
  }

  acknowledgeIntro(): void {
    this.state.updatePrefs({ introSeen: true });
    this.notify(null);
  }

  /** The browser's one-time on-device language download, started by the person. */
  async download(): Promise<void> {
    this.notify({ kind: "downloading" });
    const ok = await this.engines.local.prepare(this.lang());
    this.notify(
      ok
        ? { kind: "downloaded" }
        : { kind: "error", message: "The download did not finish. Try again later." },
    );
  }

  /** The person's own choice, made from a notice that says where the audio goes. */
  useVendor(): void {
    this.state.updatePrefs({ engine: "vendor", introSeen: true });
    this.notify(null);
  }
}
