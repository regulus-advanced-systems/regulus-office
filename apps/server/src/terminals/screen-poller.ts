/**
 * One floor's laptop screens (SPEC §9.4): while at least one subscriber is
 * connected, capture the visible pane of every robot on the floor every
 * `intervalMs` (2 Hz), clamp it, and push only screens that changed. Robots
 * whose screen has not changed for a while are captured less often, so an
 * idle floor costs a fraction of a busy one. Screen text is never logged.
 */
import { clampScreenText, type ScreenFeedMessage } from "@regulus/protocol";
import type { Logger } from "../logging.ts";
import type { FloorTerminalTargets, TerminalTarget } from "./targets.ts";

/** A connected client of the feed, as the poller sees it. */
export interface ScreenSubscriber {
  send(message: ScreenFeedMessage): void;
  /** Bytes queued on the socket; sending is skipped (and retried next tick) above the cap. */
  bufferedAmount(): number;
  /** Screen hash last sent per agent. */
  readonly sent: Map<string, number | bigint>;
}

export interface ScreenPollerOptions {
  floorId: string;
  sources: FloorTerminalTargets;
  logger: Logger;
  intervalMs: number;
  /** Unchanged ticks after which a screen counts as idle. */
  idleAfterTicks: number;
  /** Idle screens are captured every Nth tick only. */
  idleEvery: number;
  maxBufferedBytes: number;
}

interface Screen {
  text?: string;
  hash?: number | bigint;
  unchanged: number;
}

export class ScreenPoller {
  readonly #opts: ScreenPollerOptions;
  readonly #subscribers = new Set<ScreenSubscriber>();
  readonly #screens = new Map<string, Screen>();
  #timer: ReturnType<typeof setInterval> | undefined;
  #running: Promise<void> | undefined;
  #tickNo = 0;
  /** Pane captures issued so far (tests, rate checks). */
  captures = 0;

  constructor(options: ScreenPollerOptions) {
    this.#opts = options;
  }

  get size(): number {
    return this.#subscribers.size;
  }

  get active(): boolean {
    return this.#timer !== undefined;
  }

  add(sub: ScreenSubscriber): void {
    this.#subscribers.add(sub);
    this.#flushTo(sub);
    if (!this.#timer) {
      this.#timer = setInterval(() => void this.tick(), this.#opts.intervalMs);
      this.#timer.unref?.();
      void this.tick();
    }
  }

  /** Returns true when the last subscriber left (the poller stopped). */
  remove(sub: ScreenSubscriber): boolean {
    this.#subscribers.delete(sub);
    if (this.#subscribers.size > 0) return false;
    this.stop();
    return true;
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#screens.clear();
  }

  /** One poll; overlapping calls share the one in flight. */
  tick(): Promise<void> {
    this.#running ??= this.#poll().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  async #poll(): Promise<void> {
    const { floorId, sources, logger } = this.#opts;
    this.#tickNo += 1;
    let targets: TerminalTarget[];
    try {
      targets = await sources.listFloor(floorId);
    } catch (err) {
      logger.warn({ err, floorId }, "screen feed: listing robots failed");
      return;
    }
    const live = new Set(targets.map((t) => t.agentId));
    for (const agentId of this.#screens.keys()) {
      if (!live.has(agentId)) this.#drop(agentId);
    }
    await Promise.all(targets.map((t) => this.#capture(t)));
    if (!this.#timer) return;
    for (const sub of this.#subscribers) this.#flushTo(sub);
  }

  async #capture(target: TerminalTarget): Promise<void> {
    const { idleAfterTicks, idleEvery } = this.#opts;
    let screen = this.#screens.get(target.agentId);
    if (!screen) {
      screen = { unchanged: 0 };
      this.#screens.set(target.agentId, screen);
    }
    if (screen.unchanged >= idleAfterTicks && this.#tickNo % idleEvery !== 0) return;
    let text: string;
    try {
      this.captures += 1;
      // 0 lines of history: `capture-pane -S -0`, the visible screen only.
      text = clampScreenText(await target.runner.capturePane(target.session, 0));
    } catch (err) {
      this.#opts.logger.debug({ err, agentId: target.agentId }, "screen capture failed");
      if (screen.text !== undefined) this.#drop(target.agentId);
      return;
    }
    const hash = Bun.hash(text);
    if (hash === screen.hash) {
      screen.unchanged += 1;
      return;
    }
    screen.text = text;
    screen.hash = hash;
    screen.unchanged = 0;
  }

  /** The robot is gone (left the floor, exited, capture failed): dark screen. */
  #drop(agentId: string): void {
    this.#screens.delete(agentId);
    for (const sub of this.#subscribers) {
      if (sub.sent.delete(agentId)) sub.send({ type: "removed", agentId });
    }
  }

  #flushTo(sub: ScreenSubscriber): void {
    for (const [agentId, screen] of this.#screens) {
      if (screen.text === undefined || screen.hash === undefined) continue;
      if (sub.sent.get(agentId) === screen.hash) continue;
      // A slow client skips this round; the hash mismatch makes the next tick retry.
      if (sub.bufferedAmount() > this.#opts.maxBufferedBytes) return;
      sub.send({ type: "screen", agentId, text: screen.text });
      sub.sent.set(agentId, screen.hash);
    }
  }
}
