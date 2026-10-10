/**
 * A scripted speech recogniser for the dictation e2e (#260). A headless browser has no
 * microphone and no speech engine, so the page's `SpeechRecognition` is replaced by one the
 * test drives: it records how it was started (language, `processLocally`), "hears" what the
 * test says, and ends when stopped, as the browser's does. Everything else is the real page:
 * the key, the focus, the indicator, and how the text lands.
 */
import type { Page } from "@playwright/test";

export interface FakeSpeechState {
  /** Recognisers constructed (each one would open the microphone). */
  made: number;
  starts: Array<{ lang: string; processLocally: boolean | null }>;
  stops: number;
  aborts: number;
  /** A recogniser is listening now. */
  live: boolean;
  installs: number;
}

interface FakeSpeechWindow {
  __fakeSpeech?: FakeSpeechState & {
    interim(text: string): void;
    final(text: string): void;
  };
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
}

/**
 * Replace the page's speech recognition. `onDevice`: what the browser's on-device API says
 * ("available", "downloadable"), or null for a browser without that API.
 */
export async function installFakeSpeech(page: Page, onDevice: string | null): Promise<void> {
  await page.evaluate((availability) => {
    const w = window as unknown as FakeSpeechWindow;
    type Result = { isFinal: boolean; 0: { transcript: string } };
    let current: Fake | null = null;
    let state = availability;
    class Fake {
      lang = "";
      continuous = false;
      interimResults = false;
      processLocally: boolean | null = null;
      onstart: (() => void) | null = null;
      onresult: ((e: { resultIndex: number; results: Result[] }) => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() {
        api.made += 1;
      }
      start() {
        api.starts.push({ lang: this.lang, processLocally: this.processLocally });
        current = this;
        api.live = true;
        // As the browser: listening starts a moment after the call.
        setTimeout(() => this.onstart?.(), 30);
      }
      private finish() {
        if (current !== this) return;
        current = null;
        api.live = false;
        setTimeout(() => this.onend?.(), 30);
      }
      stop() {
        api.stops += 1;
        this.finish();
      }
      abort() {
        api.aborts += 1;
        this.finish();
      }
    }
    const say = (text: string, isFinal: boolean) =>
      current?.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
    const api = {
      made: 0,
      starts: [] as Array<{ lang: string; processLocally: boolean | null }>,
      stops: 0,
      aborts: 0,
      live: false,
      installs: 0,
      interim: (text: string) => say(text, false),
      final: (text: string) => say(text, true),
    };
    const ctor = Fake as unknown as Record<string, unknown>;
    if (state !== null) {
      // As the real interface: the attribute is on the prototype, the methods are static.
      Object.defineProperty(Fake.prototype, "processLocally", {
        value: false,
        writable: true,
        configurable: true,
      });
      ctor.available = async () => state;
      ctor.install = async () => {
        api.installs += 1;
        state = "available";
        return true;
      };
    }
    w.__fakeSpeech = api;
    w.SpeechRecognition = Fake;
    w.webkitSpeechRecognition = Fake;
  }, onDevice);
}

export const speech = (page: Page): Promise<FakeSpeechState> =>
  page.evaluate(() => {
    const s = (window as unknown as FakeSpeechWindow).__fakeSpeech;
    if (!s) throw new Error("fake speech not installed");
    return {
      made: s.made,
      starts: s.starts,
      stops: s.stops,
      aborts: s.aborts,
      live: s.live,
      installs: s.installs,
    };
  });

export const hear = (page: Page, text: string) =>
  page.evaluate((t) => (window as unknown as FakeSpeechWindow).__fakeSpeech?.interim(t), text);

export const say = (page: Page, text: string) =>
  page.evaluate((t) => (window as unknown as FakeSpeechWindow).__fakeSpeech?.final(t), text);

/** The person's dictation choices in this browser, back to a first visit. */
export const forgetDictationChoices = (page: Page) =>
  page.evaluate(() => localStorage.removeItem("regulus.dictation.v1"));

export async function holdKey(page: Page): Promise<void> {
  await page.keyboard.down("Control");
  await page.keyboard.down("Space");
}

export async function releaseKey(page: Page): Promise<void> {
  await page.keyboard.up("Space");
  await page.keyboard.up("Control");
}
