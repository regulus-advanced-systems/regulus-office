/**
 * Periodic scrollback snapshots on disk, for terminal search in M2 (#24).
 *
 * Every `intervalMs` (15 s) each tracked agent's pane history is captured and
 * written to `<dir>/<agentId>.txt` when it changed: the directory is 0700 and
 * files 0600 (pane text can contain anything the agent printed), writes are
 * atomic (temp file + rename), and each file is capped at `maxBytes` by
 * keeping the newest lines. The bridge tracks agents while someone is
 * watching; the AgentManager (#26) may track every running agent.
 */
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../logging.ts";
import { AGENT_ID_PATTERN, type TerminalTarget } from "./targets.ts";

export interface ScrollbackRecorderOptions {
  /** Directory for snapshots, e.g. `<OFFICE_DATA_DIR>/terminals/scrollback`. */
  dir: string;
  logger: Logger;
  intervalMs?: number;
  /** Lines of pane history to capture per snapshot. */
  lines?: number;
  /** Largest snapshot file in bytes. */
  maxBytes?: number;
}

export const SCROLLBACK_INTERVAL_MS = 15_000;
export const SCROLLBACK_MAX_BYTES = 1024 * 1024;
export const SCROLLBACK_CAPTURE_LINES = 10_000;

interface Tracked {
  target: TerminalTarget;
  refs: number;
  lastHash?: number | bigint;
}

/** Keep the newest part of `text` that fits in `maxBytes`, starting at a line boundary. */
export function capTail(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= maxBytes) return text;
  let start = bytes.byteLength - maxBytes;
  // Never start inside a UTF-8 sequence (continuation bytes are 0b10xxxxxx).
  while (start < bytes.byteLength && ((bytes[start] ?? 0) & 0xc0) === 0x80) start += 1;
  const tail = bytes.subarray(start).toString("utf8");
  const newline = tail.indexOf("\n");
  // Drop the partial first line unless the tail is one single line.
  return newline >= 0 ? tail.slice(newline + 1) : tail;
}

export class ScrollbackRecorder {
  readonly #dir: string;
  readonly #logger: Logger;
  readonly #lines: number;
  readonly #maxBytes: number;
  readonly #tracked = new Map<string, Tracked>();
  /** Last queued snapshot per agent: snapshots of one agent run one at a time, in order. */
  readonly #queues = new Map<string, Promise<void>>();
  readonly #timer: ReturnType<typeof setInterval>;
  #dirReady: Promise<void> | undefined;
  #tick: Promise<void> = Promise.resolve();

  constructor(options: ScrollbackRecorderOptions) {
    this.#dir = options.dir;
    this.#logger = options.logger;
    this.#lines = options.lines ?? SCROLLBACK_CAPTURE_LINES;
    this.#maxBytes = options.maxBytes ?? SCROLLBACK_MAX_BYTES;
    this.#timer = setInterval(() => {
      this.#tick = this.#tick.then(() => this.flush());
    }, options.intervalMs ?? SCROLLBACK_INTERVAL_MS);
    this.#timer.unref?.();
  }

  /** Snapshot this agent periodically until every returned release has been called. */
  track(target: TerminalTarget): () => void {
    const entry = this.#tracked.get(target.agentId) ?? { target, refs: 0 };
    entry.refs += 1;
    this.#tracked.set(target.agentId, entry);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.refs -= 1;
      if (entry.refs > 0) return;
      this.#tracked.delete(target.agentId);
      // One last snapshot so the file reflects the end of the viewing session (stop() awaits it).
      void this.#save(entry);
    };
  }

  get trackedCount(): number {
    return this.#tracked.size;
  }

  pathFor(agentId: string): string {
    if (!AGENT_ID_PATTERN.test(agentId)) throw new Error("invalid agent id");
    return join(this.#dir, `${agentId}.txt`);
  }

  /** Snapshot every tracked agent now. */
  async flush(): Promise<void> {
    await Promise.all([...this.#tracked.values()].map((entry) => this.#save(entry)));
  }

  /** Stop the timer, take a last snapshot of tracked agents and wait for every queued one. */
  async stop(): Promise<void> {
    clearInterval(this.#timer);
    await this.#tick;
    await this.flush();
    this.#tracked.clear();
    await Promise.all(this.#queues.values());
  }

  /**
   * Queue a snapshot behind the agent's previous one. Unqueued, a slow periodic
   * capture could finish after the final one of a release and overwrite the
   * newer text, and two writes would share one temp file.
   */
  #save(entry: Tracked): Promise<void> {
    const id = entry.target.agentId;
    const next = (this.#queues.get(id) ?? Promise.resolve()).then(() => this.#snapshot(entry));
    this.#queues.set(id, next);
    void next.then(() => {
      if (this.#queues.get(id) === next) this.#queues.delete(id);
    });
    return next;
  }

  async #snapshot(entry: Tracked): Promise<void> {
    const { target } = entry;
    try {
      const text = capTail(
        await target.runner.capturePane(target.session, this.#lines),
        this.#maxBytes,
      );
      const hash = Bun.hash(text);
      if (hash === entry.lastHash) return;
      await this.#ensureDir();
      const path = this.pathFor(target.agentId);
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, text, { mode: 0o600 });
      await rename(tmp, path);
      entry.lastHash = hash;
    } catch (err) {
      // A session that just ended cannot be captured; that is not worth more than debug.
      this.#logger.debug({ err, agentId: target.agentId }, "scrollback snapshot failed");
    }
  }

  #ensureDir(): Promise<void> {
    this.#dirReady ??= (async () => {
      await mkdir(this.#dir, { recursive: true, mode: 0o700 });
      await chmod(this.#dir, 0o700);
    })().catch((err: unknown) => {
      this.#dirReady = undefined;
      throw err;
    });
    return this.#dirReady;
  }
}
