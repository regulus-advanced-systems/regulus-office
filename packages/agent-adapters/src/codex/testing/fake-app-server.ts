/**
 * In-memory `PipedProcess` that plays a recorded / documented app-server
 * trace (see trace.ts). Used as `RunnerOps.spawnPiped` in unit tests.
 */
import type { PipedProcess } from "../../types.ts";
import { type Emission, parseTrace, TraceReplayer } from "./trace.ts";

export class FakeAppServerProcess implements PipedProcess {
  readonly pid = 4242;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number | null>;
  readonly replayer: TraceReplayer;
  readonly signals: string[] = [];
  #out!: ReadableStreamDefaultController<Uint8Array>;
  #resolveExit!: (code: number | null) => void;
  #buffer = "";
  #dead = false;
  readonly #encoder = new TextEncoder();

  constructor(trace: string) {
    this.replayer = new TraceReplayer(parseTrace(trace));
    this.stdout = new ReadableStream({ start: (c) => void (this.#out = c) });
    this.stderr = new ReadableStream({ start: (c) => c.close() });
    this.exited = new Promise((resolve) => {
      this.#resolveExit = resolve;
    });
    queueMicrotask(() => this.#emit(this.replayer.start()));
  }

  async write(chunk: string | Uint8Array): Promise<void> {
    if (this.#dead) throw new Error("EPIPE");
    this.#buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    for (let nl = this.#buffer.indexOf("\n"); nl >= 0; nl = this.#buffer.indexOf("\n")) {
      const line = this.#buffer.slice(0, nl);
      this.#buffer = this.#buffer.slice(nl + 1);
      const replies = this.replayer.receive(line);
      // Reply asynchronously, like a real process.
      queueMicrotask(() => this.#emit(replies));
    }
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    this.signals.push(signal);
    this.#exit(null);
  }

  #emit(emissions: Emission[]): void {
    for (const e of emissions) {
      if (this.#dead) return;
      if ("exit" in e) this.#exit(e.exit);
      else this.#out.enqueue(this.#encoder.encode(`${e.line}\n`));
    }
  }

  #exit(code: number | null): void {
    if (this.#dead) return;
    this.#dead = true;
    this.#out.close();
    this.#resolveExit(code);
  }
}

/** Load a fixture next to this module (`../fixtures/<name>`). */
export async function loadFixture(name: string): Promise<string> {
  return Bun.file(new URL(`../fixtures/${name}`, import.meta.url)).text();
}
