/**
 * Client→server clock sync (research 01 §5; #47): NTP-style four-timestamp
 * pings over the BuildingRoom. The client sends `clock.ping` with `t0` (its
 * clock), the server answers `clock.pong` with the receive time `t1` and the
 * send time `t2` (server clock), and the client notes `t3` on arrival:
 *
 *   offset = ((t1 - t0) + (t2 - t3)) / 2     server clock − client clock
 *   rtt    = (t3 - t0) - (t2 - t1)           time on the wire
 *
 * The error of one sample is at most rtt / 2, so the estimator keeps a short
 * window of samples and trusts the ones with the lowest round trip.
 */
import { z } from "zod";

/** Server→client answer to a `clock.ping` (commands/lobby.ts). */
export const CLOCK_PONG_MESSAGE = "clock.pong";

export const ClockPong = z.object({
  /** Echo of the ping's id. */
  id: z.number().int().nonnegative(),
  t0: z.number().finite(),
  t1: z.number().finite(),
  t2: z.number().finite(),
});
export type ClockPong = z.infer<typeof ClockPong>;

export interface ClockSample {
  /** Server clock minus client clock, ms. */
  offset: number;
  /** Round trip without the server's own processing time, ms. */
  rtt: number;
  /** Client time the sample arrived (`t3`). */
  at: number;
}

/** One sample from the four timestamps; null when they are inconsistent (negative rtt). */
export function clockSample(t0: number, t1: number, t2: number, t3: number): ClockSample | null {
  const rtt = t3 - t0 - (t2 - t1);
  if (!Number.isFinite(rtt) || rtt < 0 || t2 < t1) return null;
  return { offset: (t1 - t0 + (t2 - t3)) / 2, rtt, at: t3 };
}

export interface ClockEstimate {
  offset: number;
  /** Bound on the estimate's error: half the best round trip, ms. */
  error: number;
  samples: number;
}

export const CLOCK_SYNC = {
  /** Samples kept; older ones drop out. */
  window: 12,
  /** The offset is the median of this many lowest-rtt samples. */
  best: 3,
  /** Pings in the burst after joining, and their spacing. */
  burst: 6,
  burstSpacingMs: 150,
  /** Then one ping this often. */
  intervalMs: 10_000,
} as const;

/**
 * Keeps the last `window` samples and estimates the offset as the median of
 * the `best` lowest-rtt ones: a congested round trip (rtt large) cannot pull
 * the estimate, and one lucky outlier cannot either.
 */
export class ClockEstimator {
  private readonly samples: ClockSample[] = [];

  constructor(
    private readonly window: number = CLOCK_SYNC.window,
    private readonly best: number = CLOCK_SYNC.best,
  ) {}

  add(sample: ClockSample | null): void {
    if (!sample) return;
    this.samples.push(sample);
    while (this.samples.length > this.window) this.samples.shift();
  }

  get size(): number {
    return this.samples.length;
  }

  /** The current estimate; null before the first sample. */
  estimate(): ClockEstimate | null {
    if (this.samples.length === 0) return null;
    const ranked = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, this.best);
    const offsets = ranked.map((s) => s.offset).sort((a, b) => a - b);
    const mid = Math.floor(offsets.length / 2);
    const offset =
      offsets.length % 2 === 1
        ? (offsets[mid] as number)
        : ((offsets[mid - 1] as number) + (offsets[mid] as number)) / 2;
    return { offset, error: (ranked[0] as ClockSample).rtt / 2, samples: this.samples.length };
  }

  reset(): void {
    this.samples.length = 0;
  }
}
