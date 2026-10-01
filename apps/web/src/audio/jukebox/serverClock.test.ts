import { describe, expect, test } from "bun:test";
import { CLOCK_SYNC } from "@regulus/protocol";
import { jukeboxGain } from "./jukeboxGain.ts";
import { type ClockLink, createServerClock } from "./serverClock.ts";

/** A fake link to a server whose clock runs `skew` ms ahead, `oneWay` ms away. */
function fakeServer(skew: number, oneWay: number) {
  const local = { now: 1_000_000 };
  let listener: ((payload: unknown) => void) | null = null;
  const timers: Array<{ at: number; fn: () => void }> = [];
  const inFlight: Array<{ at: number; payload: unknown }> = [];
  let pings = 0;
  const link: ClockLink = {
    ping(id, t0) {
      pings += 1;
      const t1 = local.now + oneWay + skew;
      inFlight.push({ at: local.now + 2 * oneWay, payload: { id, t0, t1, t2: t1 } });
    },
    onPong(l) {
      listener = l;
      return () => {
        listener = null;
      };
    },
  };
  const schedule = (fn: () => void, ms: number) => {
    const timer = { at: local.now + ms, fn };
    timers.push(timer);
    return () => {
      const i = timers.indexOf(timer);
      if (i >= 0) timers.splice(i, 1);
    };
  };
  /** Run the world forward `ms`, delivering pongs and timers in order. */
  const advance = (ms: number) => {
    const end = local.now + ms;
    for (;;) {
      const next = [...timers.map((t) => t.at), ...inFlight.map((p) => p.at)]
        .filter((t) => t <= end)
        .sort((a, b) => a - b)[0];
      if (next === undefined) break;
      local.now = next;
      for (const p of inFlight.filter((x) => x.at <= local.now)) {
        inFlight.splice(inFlight.indexOf(p), 1);
        listener?.(p.payload);
      }
      for (const t of timers.filter((x) => x.at <= local.now)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    }
    local.now = end;
  };
  return { local, link, schedule, advance, pings: () => pings };
}

describe("server clock", () => {
  test("a burst of pings finds the offset within a second", () => {
    const s = fakeServer(42_000, 15);
    const clock = createServerClock({
      link: s.link,
      clock: () => s.local.now,
      schedule: s.schedule,
    });
    expect(clock.now()).toBe(s.local.now);
    s.advance(1_000);
    expect(s.pings()).toBeGreaterThanOrEqual(CLOCK_SYNC.burst);
    expect(clock.offset).toBe(42_000);
    expect(clock.error).toBe(15);
    expect(clock.now()).toBe(s.local.now + 42_000);
    clock.stop();
  });

  test("then pings slowly; a resync bursts again", () => {
    const s = fakeServer(-500, 5);
    const clock = createServerClock({
      link: s.link,
      clock: () => s.local.now,
      schedule: s.schedule,
    });
    s.advance(2_000);
    const afterBurst = s.pings();
    s.advance(CLOCK_SYNC.intervalMs * 3);
    expect(s.pings() - afterBurst).toBeLessThanOrEqual(3);
    clock.resync();
    s.advance(1_000);
    expect(s.pings() - afterBurst).toBeGreaterThanOrEqual(CLOCK_SYNC.burst);
    expect(clock.offset).toBe(-500);
    clock.stop();
  });

  test("pongs it did not send, or malformed ones, are ignored", () => {
    let listener: ((p: unknown) => void) | null = null;
    const clock = createServerClock({
      link: {
        ping: () => undefined,
        onPong: (l) => {
          listener = l;
          return () => undefined;
        },
      },
      clock: () => 0,
      schedule: () => () => undefined,
    });
    (listener as ((p: unknown) => void) | null)?.({ id: 99, t0: 0, t1: 9e9, t2: 9e9 });
    (listener as ((p: unknown) => void) | null)?.("nonsense");
    expect(clock.offset).toBe(0);
    expect(clock.error).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("jukeboxGain", () => {
  test("volume × office level × spatial level; mute wins; junk is silent", () => {
    expect(jukeboxGain({ volume: 0.8, muted: false, officeVolume: 0.5, level: 0.5 })).toBeCloseTo(
      0.2,
      9,
    );
    expect(jukeboxGain({ volume: 1, muted: true, officeVolume: 1, level: 1 })).toBe(0);
    expect(jukeboxGain({ volume: 2, muted: false, officeVolume: 1, level: Number.NaN })).toBe(0);
    expect(jukeboxGain({ volume: 2, muted: false, officeVolume: 1, level: 1 })).toBe(1);
  });
});
