/** Scripted speech engines for the dictation tests. Only imported by tests. */
import type {
  DictationEngine,
  DictationEngineId,
  DictationEngines,
  DictationHandlers,
  EngineAvailability,
} from "./engine.ts";

export class FakeEngine implements DictationEngine {
  isSupported = true;
  available: EngineAvailability = "ready";
  /** Call `onStart` from `start` (a granted microphone); off: the test calls `open()`. */
  autoStart = true;
  /** `stop` delivers `onEnd` at once; off: the engine hangs until `end()`. */
  endsOnStop = true;
  prepareResult = true;
  starts: string[] = [];
  stops = 0;
  aborts = 0;
  prepared: string[] = [];
  handlers: DictationHandlers | null = null;
  constructor(readonly id: DictationEngineId) {}
  supported() {
    return this.isSupported;
  }
  async availability() {
    return this.available;
  }
  async prepare(lang: string) {
    this.prepared.push(lang);
    if (this.prepareResult) this.available = "ready";
    return this.prepareResult;
  }
  start(lang: string, handlers: DictationHandlers) {
    this.starts.push(lang);
    this.handlers = handlers;
    if (this.autoStart) handlers.onStart();
    return {
      stop: () => {
        this.stops += 1;
        if (this.endsOnStop) this.end();
      },
      abort: () => {
        this.aborts += 1;
        this.end();
      },
    };
  }
  /** The microphone is open. */
  open() {
    this.handlers?.onStart();
  }
  hear(text: string) {
    this.handlers?.onInterim(text);
  }
  say(text: string) {
    this.handlers?.onFinal(text);
  }
  end() {
    const handlers = this.handlers;
    this.handlers = null;
    handlers?.onEnd();
  }
  get listening() {
    return this.handlers !== null;
  }
}

export function fakeEngines(): DictationEngines & { local: FakeEngine; vendor: FakeEngine } {
  return { local: new FakeEngine("local"), vendor: new FakeEngine("vendor") };
}

/** Let the controller's availability check (a promise) settle. */
export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
