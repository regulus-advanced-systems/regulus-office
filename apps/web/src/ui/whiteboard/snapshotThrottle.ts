/**
 * Throttle for the wall snapshot (#45, research 01 §7 "throttled ~2 s"):
 * every local change pokes it; it runs the render + upload at most once per
 * `intervalMs` (the first change waits nothing beyond the interval since the
 * last run), never two at once, and runs once more after a change that came
 * in while a run was busy. `flush()` runs a pending render now (closing the
 * editor), `cancel()` drops it.
 */

export interface SnapshotThrottleOptions {
  intervalMs: number;
  run: () => Promise<void>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface SnapshotThrottle {
  /** Something changed locally: a snapshot is due. */
  poke(): void;
  /** Run a due snapshot now (resolves when it is uploaded). */
  flush(): Promise<void>;
  /** Forget any due snapshot. */
  cancel(): void;
  /** A snapshot is due or running. */
  readonly pending: boolean;
}

export function createSnapshotThrottle(options: SnapshotThrottleOptions): SnapshotThrottle {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let lastRun = Number.NEGATIVE_INFINITY;
  let due = false;
  let running: Promise<void> | null = null;
  let timer: unknown = null;

  const schedule = () => {
    if (timer !== null || running || !due) return;
    const wait = Math.max(0, lastRun + options.intervalMs - now());
    timer = setTimer(() => {
      timer = null;
      void start();
    }, wait);
  };

  const start = (): Promise<void> => {
    if (running) return running;
    if (!due) return Promise.resolve();
    due = false;
    lastRun = now();
    running = options
      .run()
      .catch(() => {})
      .finally(() => {
        running = null;
        schedule();
      });
    return running;
  };

  return {
    poke() {
      due = true;
      schedule();
    },
    async flush() {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      if (running) await running;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      await start();
    },
    cancel() {
      due = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    get pending() {
      return due || running !== null;
    },
  };
}
