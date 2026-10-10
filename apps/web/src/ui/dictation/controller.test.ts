import { beforeEach, describe, expect, test } from "bun:test";
import { DictationController, ERROR_TEXT, FINISH_TIMEOUT_MS, NOTICE_MS } from "./controller.ts";
import { createDictationStore, DICTATION_STORAGE_KEY } from "./dictationStore.ts";
import { fakeEngines, settle } from "./fakeEngine.ts";
import type { DictationTarget, TargetLookup } from "./targets.ts";

class FakeTarget implements DictationTarget {
  kind = "field" as const;
  element = {} as HTMLElement;
  typed: string[] = [];
  live = true;
  alive() {
    return this.live;
  }
  insert(phrase: string) {
    this.typed.push(phrase);
  }
}

function setup(prefs: Record<string, unknown> = { introSeen: true }) {
  const saved = new Map<string, string>([[DICTATION_STORAGE_KEY, JSON.stringify(prefs)]]);
  const store = createDictationStore({
    getItem: (k) => saved.get(k) ?? null,
    setItem: (k, v) => void saved.set(k, v),
  });
  const engines = fakeEngines();
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const voice = { paused: 0, resumed: 0, live: false };
  const controller = new DictationController({
    engines,
    store,
    browserLang: () => "en-GB",
    pauseVoice: () => {
      if (!voice.live) return null;
      voice.paused += 1;
      return () => {
        voice.resumed += 1;
      };
    },
    setTimer: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { live: boolean }).live = false;
    },
  });
  const target = new FakeTarget();
  const lookup: TargetLookup = { target };
  const fire = (ms: number) => {
    for (const t of timers.filter((x) => x.live && x.ms === ms)) {
      t.live = false;
      t.fn();
    }
  };
  return { controller, store, engines, target, lookup, fire, voice, saved };
}

let s: ReturnType<typeof setup>;
beforeEach(() => {
  s = setup();
});
const state = () => s.store.getState();

describe("hold to dictate", () => {
  test("a press listens with the on-device engine; phrases are typed; a release stops", async () => {
    expect(s.controller.begin(s.lookup)).toBe(true);
    await settle();
    expect(s.engines.local.starts).toEqual(["en-GB"]);
    expect(s.engines.vendor.starts).toEqual([]);
    expect(state().phase).toBe("listening");
    expect(state().recordingAt).toBe(s.target.element);

    s.engines.local.hear("fix the\nbuild");
    expect(state().interim).toBe("fix the build");
    s.engines.local.say("fix the build");
    expect(s.target.typed).toEqual(["fix the build"]);
    expect(state().interim).toBe("");

    s.controller.release();
    expect(s.engines.local.stops).toBe(1);
    expect(s.engines.local.listening).toBe(false);
    expect(state().phase).toBe("idle");
    expect(state().recordingAt).toBeNull();
  });

  test("the last phrase arrives after the release and is still typed", async () => {
    s.engines.local.endsOnStop = false;
    s.controller.begin(s.lookup);
    await settle();
    s.controller.release();
    expect(state().phase).toBe("finishing");
    s.engines.local.say("and open a PR");
    s.engines.local.end();
    expect(s.target.typed).toEqual(["and open a PR"]);
    expect(state().phase).toBe("idle");
  });

  test("an engine that does not stop is cut off after the release", async () => {
    s.engines.local.endsOnStop = false;
    s.controller.begin(s.lookup);
    await settle();
    s.controller.release();
    expect(s.engines.local.listening).toBe(true);
    s.fire(FINISH_TIMEOUT_MS);
    expect(s.engines.local.aborts).toBe(1);
    expect(state().phase).toBe("idle");
  });

  test("a release before the microphone opened aborts", async () => {
    s.engines.local.autoStart = false;
    s.controller.begin(s.lookup);
    await settle();
    expect(state().phase).toBe("starting");
    s.controller.release();
    expect(s.engines.local.aborts).toBe(1);
    expect(state().phase).toBe("idle");
  });

  test("a release while the engine was still being checked never opens the microphone", async () => {
    s.controller.begin(s.lookup);
    s.controller.release();
    await settle();
    expect(s.engines.local.starts).toEqual([]);
    expect(state().phase).toBe("idle");
  });

  test("a second press while held changes nothing; a new hold starts again", async () => {
    s.controller.begin(s.lookup);
    s.controller.begin(s.lookup);
    await settle();
    expect(s.engines.local.starts.length).toBe(1);
    s.controller.release();
    s.controller.begin(s.lookup);
    await settle();
    expect(s.engines.local.starts.length).toBe(2);
  });

  test("a target that went away takes no more text", async () => {
    s.controller.begin(s.lookup);
    await settle();
    s.target.live = false;
    s.engines.local.say("lost words");
    expect(s.target.typed).toEqual([]);
  });

  test("cancel drops what was not typed yet", async () => {
    s.engines.local.endsOnStop = false;
    s.controller.begin(s.lookup);
    await settle();
    const handlers = s.engines.local.handlers;
    s.controller.cancel();
    handlers?.onFinal("too late");
    expect(s.target.typed).toEqual([]);
    expect(state().phase).toBe("idle");
  });

  test("the chosen language wins over the browser's", async () => {
    state().updatePrefs({ lang: "de-DE" });
    s.controller.begin(s.lookup);
    await settle();
    expect(s.engines.local.starts).toEqual(["de-DE"]);
  });
});

describe("what the key is taken for", () => {
  test("nothing focused that takes text: not taken", () => {
    expect(s.controller.begin(null)).toBe(false);
    expect(state().notice).toBeNull();
  });

  test("dictation off: not taken, even in a text box", async () => {
    state().updatePrefs({ enabled: false });
    expect(s.controller.begin(s.lookup)).toBe(false);
    await settle();
    expect(s.engines.local.starts).toEqual([]);
  });

  test("a watched terminal: taken, says so, records nothing", async () => {
    expect(s.controller.begin({ blocked: "watch-only" })).toBe(true);
    await settle();
    expect(state().notice).toEqual({ kind: "watch-only" });
    expect(s.engines.local.starts).toEqual([]);
    s.fire(NOTICE_MS);
    expect(state().notice).toBeNull();
  });
});

describe("where the audio goes", () => {
  test("the first press ever records nothing and says where the audio goes", async () => {
    s = setup({});
    s.controller.begin(s.lookup);
    await settle();
    expect(state().notice).toEqual({ kind: "intro" });
    expect(s.engines.local.starts).toEqual([]);
    s.controller.release();

    s.controller.acknowledgeIntro();
    expect(state().notice).toBeNull();
    expect(JSON.parse(s.saved.get(DICTATION_STORAGE_KEY) ?? "{}").introSeen).toBe(true);
    s.controller.begin(s.lookup);
    await settle();
    expect(s.engines.local.starts.length).toBe(1);
  });

  test("a second press with the notice up has read it", async () => {
    s = setup({});
    s.controller.begin(s.lookup);
    await settle();
    s.controller.release();
    s.controller.begin(s.lookup);
    await settle();
    expect(state().prefs.introSeen).toBe(true);
    expect(s.engines.local.starts.length).toBe(1);
    expect(state().notice).toBeNull();
  });

  test("no on-device engine: nothing is recorded and the online service is only offered", async () => {
    s.engines.local.available = "unavailable";
    s.controller.begin(s.lookup);
    await settle();
    expect(state().notice).toEqual({ kind: "local-unavailable" });
    expect(s.engines.vendor.starts).toEqual([]);
    expect(s.engines.local.starts).toEqual([]);
    s.controller.release();

    // Declined: still nothing goes out on the next press.
    s.controller.dismissNotice();
    s.controller.begin(s.lookup);
    await settle();
    expect(s.engines.vendor.starts).toEqual([]);
    s.controller.release();

    // Chosen: the online service runs from now on, and the choice is remembered.
    s.controller.useVendor();
    expect(JSON.parse(s.saved.get(DICTATION_STORAGE_KEY) ?? "{}").engine).toBe("vendor");
    s.controller.begin(s.lookup);
    await settle();
    expect(s.engines.vendor.starts).toEqual(["en-GB"]);
    expect(s.engines.local.starts).toEqual([]);
  });

  test("the on-device download is started by the person, then dictation works", async () => {
    s.engines.local.available = "needs-download";
    s.controller.begin(s.lookup);
    await settle();
    expect(state().notice).toEqual({ kind: "download" });
    expect(s.engines.local.prepared).toEqual([]);
    s.controller.release();

    await s.controller.download();
    expect(s.engines.local.prepared).toEqual(["en-GB"]);
    expect(state().notice).toEqual({ kind: "downloaded" });
    s.controller.begin(s.lookup);
    await settle();
    expect(s.engines.local.starts.length).toBe(1);
  });

  test("a download that fails says so", async () => {
    s.engines.local.available = "needs-download";
    s.engines.local.prepareResult = false;
    await s.controller.download();
    expect(state().notice?.kind).toBe("error");
  });

  test("a browser without speech recognition says so", async () => {
    s.engines.local.isSupported = false;
    s.engines.vendor.isSupported = false;
    expect(s.controller.begin(s.lookup)).toBe(true);
    await settle();
    expect(state().notice).toEqual({ kind: "unsupported" });
  });

  test("a blocked microphone is told plainly and the hold ends", async () => {
    s.controller.begin(s.lookup);
    await settle();
    s.engines.local.handlers?.onError("mic-blocked");
    s.engines.local.end();
    expect(state().notice).toEqual({ kind: "error", message: ERROR_TEXT["mic-blocked"] });
    expect(state().phase).toBe("idle");
    // The key is still down; letting go does nothing more.
    s.controller.release();
    expect(s.engines.local.stops).toBe(0);
  });
});

describe("voice chat", () => {
  test("an open voice mic is muted for the hold and put back after", async () => {
    s.voice.live = true;
    s.controller.begin(s.lookup);
    await settle();
    expect(s.voice.paused).toBe(1);
    expect(state().voicePaused).toBe(true);
    expect(s.voice.resumed).toBe(0);
    s.controller.release();
    expect(s.voice.resumed).toBe(1);
    expect(state().voicePaused).toBe(false);
  });

  test("a silent voice mic is left alone", async () => {
    s.controller.begin(s.lookup);
    await settle();
    expect(state().voicePaused).toBe(false);
    s.controller.release();
    expect(s.voice.resumed).toBe(0);
  });
});
