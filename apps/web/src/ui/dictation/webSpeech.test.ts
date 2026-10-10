import { beforeEach, describe, expect, test } from "bun:test";
import type { DictationErrorCode } from "./engine.ts";
import {
  createWebSpeechEngine,
  type SpeechRecognitionCtor,
  type SpeechRecognitionLike,
  type SpeechResultEventLike,
  speechErrorCode,
} from "./webSpeech.ts";

class FakeRecognition implements SpeechRecognitionLike {
  static made: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  processLocally?: boolean;
  onstart: (() => void) | null = null;
  onresult: ((event: SpeechResultEventLike) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  calls: string[] = [];
  constructor() {
    FakeRecognition.made.push(this);
  }
  start() {
    this.calls.push("start");
  }
  stop() {
    this.calls.push("stop");
  }
  abort() {
    this.calls.push("abort");
  }
}

/** A browser with the on-device API. */
function onDevice(state: string, installs: unknown[] = []): SpeechRecognitionCtor {
  return class extends FakeRecognition {
    static available = async () => state;
    static install = async (q: unknown) => {
      installs.push(q);
      return true;
    };
  };
}

function record() {
  const log: string[] = [];
  const errors: DictationErrorCode[] = [];
  return {
    log,
    errors,
    handlers: {
      onStart: () => void log.push("start"),
      onInterim: (t: string) => void log.push(`interim:${t}`),
      onFinal: (t: string) => void log.push(`final:${t}`),
      onError: (c: DictationErrorCode) => void errors.push(c),
      onEnd: () => void log.push("end"),
    },
  };
}

const results = (...items: Array<[text: string, final: boolean]>) =>
  items.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } }));

beforeEach(() => {
  FakeRecognition.made = [];
});

describe("the on-device engine", () => {
  test("a browser without the on-device API never starts it: the flag would be ignored", async () => {
    // Web Speech as older browsers have it: no static `available`.
    const engine = createWebSpeechEngine("local", () => FakeRecognition);
    expect(engine.supported()).toBe(false);
    expect(await engine.availability("en-US")).toBe("unavailable");
    expect(await engine.prepare("en-US")).toBe(false);
    const r = record();
    engine.start("en-US", r.handlers);
    expect(FakeRecognition.made).toEqual([]);
    expect(r.errors).toEqual(["failed"]);
    expect(r.log).toEqual(["end"]);
  });

  test("maps the browser's availability and asks it to keep the audio local", async () => {
    for (const [state, want] of [
      ["available", "ready"],
      ["downloadable", "needs-download"],
      ["downloading", "downloading"],
      ["unavailable", "unavailable"],
      ["something-new", "unavailable"],
    ] as const) {
      const engine = createWebSpeechEngine("local", () => onDevice(state));
      expect(await engine.availability("en-US")).toBe(want);
    }
    const installs: unknown[] = [];
    const engine = createWebSpeechEngine("local", () => onDevice("downloadable", installs));
    expect(await engine.prepare("de-DE")).toBe(true);
    expect(installs).toEqual([{ langs: ["de-DE"], processLocally: true }]);
  });

  test("an availability check that throws counts as unavailable", async () => {
    const ctor = class extends FakeRecognition {
      static available = async () => {
        throw new Error("no");
      };
    };
    expect(await createWebSpeechEngine("local", () => ctor).availability("en-US")).toBe(
      "unavailable",
    );
  });

  test("starts with processLocally set", () => {
    const engine = createWebSpeechEngine("local", () => onDevice("available"));
    engine.start("en-GB", record().handlers);
    const rec = FakeRecognition.made[0];
    expect(rec?.processLocally).toBe(true);
    expect(rec?.lang).toBe("en-GB");
    expect(rec?.continuous).toBe(true);
    expect(rec?.interimResults).toBe(true);
    expect(rec?.calls).toEqual(["start"]);
  });
});

describe("the browser's online engine", () => {
  test("leaves processLocally alone", async () => {
    const engine = createWebSpeechEngine("vendor", () => FakeRecognition);
    expect(engine.supported()).toBe(true);
    expect(await engine.availability("en-US")).toBe("ready");
    engine.start("en-US", record().handlers);
    expect(FakeRecognition.made[0]?.processLocally).toBeUndefined();
  });

  test("no speech recognition at all", async () => {
    const engine = createWebSpeechEngine("vendor", () => null);
    expect(engine.supported()).toBe(false);
    expect(await engine.availability("en-US")).toBe("unavailable");
  });
});

describe("a session", () => {
  const begin = () => {
    const r = record();
    const session = createWebSpeechEngine("vendor", () => FakeRecognition).start(
      "en-US",
      r.handlers,
    );
    const rec = FakeRecognition.made[0] as FakeRecognition;
    return { ...r, session, rec };
  };

  test("finished phrases and the phrase in progress are told apart", () => {
    const s = begin();
    s.rec.onstart?.();
    s.rec.onresult?.({ resultIndex: 0, results: results(["fix the", false]) });
    s.rec.onresult?.({
      resultIndex: 0,
      results: results(["fix the build", true], [" and then", false], [" push", false]),
    });
    expect(s.log).toEqual([
      "start",
      "interim:fix the",
      "final:fix the build",
      "interim: and then push",
    ]);
  });

  test("stop asks the browser to finish; the end comes from the browser, once", () => {
    const s = begin();
    s.session.stop();
    expect(s.rec.calls).toEqual(["start", "stop"]);
    expect(s.log).toEqual([]);
    s.rec.onresult?.({ resultIndex: 0, results: results(["last words", true]) });
    s.rec.onend?.();
    s.rec.onend?.();
    expect(s.log).toEqual(["final:last words", "interim:", "end"]);
  });

  test("abort ends at once and drops what comes after", () => {
    const s = begin();
    s.session.abort();
    expect(s.rec.calls).toEqual(["start", "abort"]);
    s.rec.onresult?.({ resultIndex: 0, results: results(["too late", true]) });
    s.rec.onerror?.({ error: "network" });
    s.rec.onend?.();
    expect(s.log).toEqual(["end"]);
    expect(s.errors).toEqual([]);
  });

  test("a start that throws ends the session with an error", () => {
    const ctor = class extends FakeRecognition {
      override start() {
        throw new Error("already started");
      }
    };
    const r = record();
    createWebSpeechEngine("vendor", () => ctor).start("en-US", r.handlers);
    expect(r.errors).toEqual(["failed"]);
    expect(r.log).toEqual(["end"]);
  });

  test("errors worth telling are named; silence and our own abort are not", () => {
    expect(speechErrorCode("not-allowed")).toBe("mic-blocked");
    expect(speechErrorCode("service-not-allowed")).toBe("mic-blocked");
    expect(speechErrorCode("audio-capture")).toBe("no-mic");
    expect(speechErrorCode("network")).toBe("network");
    expect(speechErrorCode("language-not-supported")).toBe("language");
    expect(speechErrorCode("bad-grammar")).toBe("failed");
    expect(speechErrorCode("no-speech")).toBeNull();
    expect(speechErrorCode("aborted")).toBeNull();
    const s = begin();
    s.rec.onerror?.({ error: "no-speech" });
    s.rec.onerror?.({ error: "not-allowed" });
    expect(s.errors).toEqual(["mic-blocked"]);
  });
});
