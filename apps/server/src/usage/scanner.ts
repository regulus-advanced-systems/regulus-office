/**
 * Periodic transcript scan (#40, research 04 §4): every few minutes, for each
 * human with a Claude Code robot that is live or was active recently, ask the
 * adapter's `readUsage` in that human's own runner. The scan itself runs as
 * the runner identity (claude-code/transcript-scan.ts); the office process
 * never opens a human's HOME. Humans are scanned one at a time.
 */
import type { AgentAdapter, RunnerContext } from "@regulus/agent-adapters";
import type { UsageSample } from "@regulus/protocol";
import { and, eq, gte, inArray, or } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { agents } from "../db/schema/index.ts";
import type { Logger } from "../logging.ts";
import { bindRunnerOps, type Runner } from "../runners/types.ts";
import type { UsageTracker } from "./tracker.ts";

export const SCAN_INTERVAL_MS = 5 * 60_000;
/** After a robot's last activity its transcripts are still scanned this long. */
export const SCAN_RECENT_MS = 60 * 60_000;
/** How far back a scan looks after an office restart (weekly window + a day). */
export const SCAN_LOOKBACK_MS = 8 * 24 * 60 * 60_000;

const SCANNED_STATUSES = [
  "starting",
  "idle",
  "working",
  "waiting_permission",
  "waiting_input",
  "done",
  "error",
] as const;

export interface TranscriptScanLoopOptions {
  db: Db;
  runner: Runner;
  /** The Claude Code adapter instance the office runs. */
  adapter: AgentAdapter;
  tracker: UsageTracker;
  officeUrl: string;
  logger: Logger;
  intervalMs?: number;
  now?: () => number;
}

export class TranscriptScanLoop {
  readonly #o: TranscriptScanLoopOptions;
  readonly #now: () => number;
  #timer: ReturnType<typeof setInterval> | undefined;
  #running: Promise<void> | undefined;
  #abort = new AbortController();

  constructor(opts: TranscriptScanLoopOptions) {
    this.#o = opts;
    this.#now = opts.now ?? Date.now;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.scanOnce(), this.#o.intervalMs ?? SCAN_INTERVAL_MS);
    this.#timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#abort.abort();
    await this.#running;
  }

  /** Humans whose runner has Claude Code transcripts worth reading now. */
  targets(): string[] {
    const recent = new Date(this.#now() - SCAN_RECENT_MS);
    const rows = this.#o.db
      .selectDistinct({ userId: agents.ownerUserId })
      .from(agents)
      .where(
        and(
          eq(agents.provider, "claude-code"),
          or(inArray(agents.status, [...SCANNED_STATUSES]), gte(agents.lastActivityAt, recent)),
        ),
      )
      .all();
    return rows.map((r) => r.userId).sort();
  }

  /** One pass over every target; a pass still running is joined, not doubled. */
  scanOnce(): Promise<void> {
    this.#running ??= this.#pass().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  async #pass(): Promise<void> {
    for (const userId of this.targets()) {
      if (this.#abort.signal.aborted) return;
      try {
        await this.scanUser(userId);
      } catch (err) {
        this.#o.logger.warn({ userId, err: String(err) }, "usage transcript scan failed");
      }
    }
  }

  /** Scan one human's runner and store what is new. */
  async scanUser(userId: string): Promise<{ stored: number; superseded: number }> {
    const { runner, adapter, tracker } = this.#o;
    const handle = await runner.provision({ userId });
    const ctx: RunnerContext = {
      backend: runner.backend,
      userId,
      home: handle.home,
      runner: bindRunnerOps(runner, { userId }),
      officeUrl: this.#o.officeUrl,
      now: this.#now,
    };
    const startedAt = this.#now();
    const samples: UsageSample[] = [];
    let stored = 0;
    const flush = () => {
      stored += tracker.transcriptSamples(userId, adapter.id, samples.splice(0));
    };
    const sessions = new Set<string>();
    const opts = { since: startedAt - SCAN_LOOKBACK_MS, signal: this.#abort.signal };
    for await (const s of adapter.readUsage(ctx, opts)) {
      if ("windowKind" in s) {
        tracker.limit(userId, adapter.id, s);
        continue;
      }
      if (s.source !== "transcript") continue;
      if (s.sessionId) sessions.add(s.sessionId);
      samples.push(s);
      if (samples.length >= 500) flush();
    }
    flush();
    // The transcript now counts these sessions' requests; their provisional
    // statusline samples from before the scan started would count them twice.
    const superseded = tracker.store.supersedeStatusline([...sessions], startedAt);
    if (stored > 0 || superseded > 0) {
      this.#o.logger.debug({ userId, stored, superseded }, "usage transcript scan");
    }
    return { stored, superseded };
  }
}
