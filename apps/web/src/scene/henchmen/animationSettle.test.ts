import { describe, expect, test } from "bun:test";
import type { AgentAction, AgentStatus, AvatarAnimation } from "@regulus/protocol";
import {
  SETTLE_MS,
  type SettleState,
  settleDeadline,
  settleStart,
  settleStep,
} from "./animationSettle.ts";
import { henchmanAnimationFor, ONE_SHOT_MS, STILL } from "./henchmanAnimation.ts";

/** Feeds a timeline of [ms, wanted] into the settle machine and samples what shows every 50 ms. */
function play(
  timeline: ReadonlyArray<readonly [number, AvatarAnimation]>,
  until: number,
): { at: number; shown: AvatarAnimation }[] {
  const [first, ...rest] = timeline;
  if (!first) return [];
  let state: SettleState = settleStart(first[1], first[0]);
  let wanted = first[1];
  const out: { at: number; shown: AvatarAnimation }[] = [];
  let next = 0;
  for (let now = first[0]; now <= until; now += 50) {
    while (rest[next] && (rest[next]?.[0] ?? Infinity) <= now) wanted = rest[next++]?.[1] ?? wanted;
    state = settleStep(state, wanted, now);
    const last = out[out.length - 1];
    if (!last || last.shown !== state.shown) out.push({ at: now, shown: state.shown });
  }
  return out;
}

const pair = (status: AgentStatus, action: AgentAction) => henchmanAnimationFor({ status, action });

describe("animation settle (#159)", () => {
  test("the first animation shows at once", () => {
    expect(settleStart("sit_type", 0).shown).toBe("sit_type");
    expect(settleStart(STILL, 0).shown).toBe(STILL);
  });

  test("a status/action stream flapping faster than the settle time never reaches the avatar", () => {
    // working/typing and idle/none alternating every 400 ms for 10 s (a status tick storm).
    const timeline: [number, AvatarAnimation][] = [];
    for (let t = 0; t < 10_000; t += 400)
      timeline.push([t, (t / 400) % 2 === 0 ? pair("idle", "none") : pair("working", "typing")]);
    expect(play(timeline, 10_000)).toEqual([{ at: 0, shown: STILL }]);
  });

  test("a real change shows once, after SETTLE_MS, and flicker in between is ignored", () => {
    const shown = play(
      [
        [0, pair("starting", "none")],
        [1000, pair("idle", "none")],
        [2000, pair("working", "thinking")],
        [2300, pair("working", "editing")],
        [2400, pair("working", "thinking")],
        [2500, pair("working", "typing")],
      ],
      8000,
    );
    // starting and idle are both still; then only the action that held for SETTLE_MS shows.
    expect(shown).toEqual([
      { at: 0, shown: STILL },
      { at: 2500 + SETTLE_MS, shown: "sit_type" },
    ]);
  });

  test("working → idle goes still after SETTLE_MS, not on every short pause", () => {
    const shown = play(
      [
        [0, pair("working", "typing")],
        [3000, pair("idle", "none")],
        [3500, pair("working", "typing")],
        [6000, pair("idle", "none")],
      ],
      10_000,
    );
    expect(shown).toEqual([
      { at: 0, shown: "sit_type" },
      { at: 6000 + SETTLE_MS, shown: STILL },
    ]);
  });

  test("a one-shot plays to its end once, then the henchman is still until something else is wanted", () => {
    const limit = ONE_SHOT_MS.celebrate ?? 0;
    const shown = play(
      [
        [0, pair("working", "typing")],
        [2000, pair("done", "none")],
      ],
      60_000,
    );
    expect(shown).toEqual([
      { at: 0, shown: "sit_type" },
      { at: 2000 + SETTLE_MS, shown: "celebrate" },
      { at: 2000 + SETTLE_MS + limit, shown: STILL },
    ]);
  });

  test("a one-shot is not cut short by what is wanted meanwhile", () => {
    const limit = ONE_SHOT_MS.facepalm ?? 0;
    const shown = play(
      [
        [0, pair("working", "typing")],
        [1000, pair("error", "none")],
        [1000 + SETTLE_MS + 200, pair("working", "typing")],
      ],
      20_000,
    );
    expect(shown).toEqual([
      { at: 0, shown: "sit_type" },
      { at: 1000 + SETTLE_MS, shown: "facepalm" },
      { at: 1000 + SETTLE_MS + limit, shown: "sit_type" },
    ]);
  });

  test("a henchman first seen done does not celebrate on page load", () => {
    expect(play([[0, pair("done", "none")]], 30_000)).toEqual([{ at: 0, shown: STILL }]);
  });

  test("the deadline says when to look again, and null when nothing is pending", () => {
    let state = settleStart(STILL, 0);
    expect(settleDeadline(state, 0)).toBeNull();
    state = settleStep(state, "sit_type", 100);
    expect(settleDeadline(state, 600)).toBe(SETTLE_MS - 500);
    state = settleStep(state, "sit_type", 100 + SETTLE_MS);
    expect(state.shown).toBe("sit_type");
    expect(settleDeadline(state, 100 + SETTLE_MS)).toBeNull();
  });
});
