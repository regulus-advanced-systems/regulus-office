/**
 * The server's clock as seen from this page (#47): four-timestamp pings over
 * the BuildingRoom (protocol clock-sync.ts) feed a `ClockEstimator`;
 * `now()` is the page's monotonic clock plus the estimated offset. A burst
 * of pings right after (re)joining gets a good estimate within a second,
 * then one ping every ten seconds follows any drift of either clock.
 */
import {
  CLOCK_PONG_MESSAGE,
  CLOCK_SYNC,
  ClockEstimator,
  ClockPong,
  clockSample,
} from "@regulus/protocol";

export interface ClockLink {
  /** Send a ping; throws when the building room is not joined. */
  ping(id: number, t0: number): void;
  /** Listen for pongs; returns the unsubscribe. */
  onPong(listener: (payload: unknown) => void): () => void;
}

export interface ServerClock {
  /** Server time (ms since epoch) now: the local clock plus the best offset (0 before any). */
  now(): number;
  readonly offset: number;
  /** Bound on the offset's error, ms; Infinity before any sample. */
  readonly error: number;
  /** Start over (a new building session): drop the samples and ping in a burst. */
  resync(): void;
  stop(): void;
}

/** Wall-clock milliseconds from the monotonic clock: steady even when the OS clock is set. */
export function localNow(): number {
  return performance.timeOrigin + performance.now();
}

export interface ServerClockOptions {
  link: ClockLink;
  clock?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export function createServerClock(options: ServerClockOptions): ServerClock {
  const clock = options.clock ?? localNow;
  const schedule = options.schedule ?? defaultSchedule;
  const estimator = new ClockEstimator();
  const sent = new Map<number, number>();
  let offset = 0;
  let error = Number.POSITIVE_INFINITY;
  let seq = 0;
  let burstLeft: number = CLOCK_SYNC.burst;
  let cancel: (() => void) | null = null;
  let stopped = false;

  const off = options.link.onPong((payload) => {
    const parsed = ClockPong.safeParse(payload);
    if (!parsed.success) return;
    const t0 = sent.get(parsed.data.id);
    if (t0 === undefined || t0 !== parsed.data.t0) return;
    sent.delete(parsed.data.id);
    estimator.add(clockSample(t0, parsed.data.t1, parsed.data.t2, clock()));
    const est = estimator.estimate();
    if (est) {
      offset = est.offset;
      error = est.error;
    }
  });

  const tick = () => {
    if (stopped) return;
    seq += 1;
    const t0 = clock();
    try {
      options.link.ping(seq, t0);
      sent.set(seq, t0);
      // Unanswered pings (a dropped connection) must not pile up.
      for (const id of sent.keys()) if (id < seq - 2 * CLOCK_SYNC.burst) sent.delete(id);
    } catch {
      // Not joined yet: try again soon.
      burstLeft = Math.max(burstLeft, 1);
    }
    const wait = burstLeft > 0 ? CLOCK_SYNC.burstSpacingMs : CLOCK_SYNC.intervalMs;
    if (burstLeft > 0) burstLeft -= 1;
    cancel = schedule(tick, wait);
  };
  cancel = schedule(tick, 0);

  return {
    now: () => clock() + offset,
    get offset() {
      return offset;
    },
    get error() {
      return error;
    },
    resync() {
      estimator.reset();
      sent.clear();
      burstLeft = CLOCK_SYNC.burst;
      cancel?.();
      cancel = schedule(tick, 0);
    },
    stop() {
      stopped = true;
      cancel?.();
      off();
    },
  };
}

/** The link over the office client's BuildingRoom. */
export function officeClockLink(client: {
  send(type: "clock.ping", payload: { id: number; t0: number }): void;
  onBuildingMessage(type: string, listener: (payload: unknown) => void): () => void;
}): ClockLink {
  return {
    ping: (id, t0) => client.send("clock.ping", { id, t0 }),
    onPong: (listener) => client.onBuildingMessage(CLOCK_PONG_MESSAGE, listener),
  };
}
