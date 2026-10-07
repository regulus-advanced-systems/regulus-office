import { describe, expect, test } from "bun:test";
import {
  ACTIVITY_RADIUS,
  FADE_SECONDS,
  fadeToward,
  NAME_TAG_RADIUS,
  nearness,
  type OverheadSight,
  overheadVisibility,
  RADIUS_FADE,
} from "./overheadVisibility.ts";

const far = 40;
const sight = (over: Partial<OverheadSight> = {}): OverheadSight => ({
  distance: 2,
  hovered: false,
  own: false,
  kind: "doing",
  activityBubbles: true,
  reducedMotion: false,
  ...over,
});

describe("which labels a viewer sees (#283)", () => {
  test("a 'doing' bubble shows near the viewer and not across the room", () => {
    expect(overheadVisibility(sight()).bubble).toBe(1);
    expect(overheadVisibility(sight({ distance: ACTIVITY_RADIUS })).bubble).toBe(1);
    expect(overheadVisibility(sight({ distance: ACTIVITY_RADIUS + RADIUS_FADE })).bubble).toBe(0);
    expect(overheadVisibility(sight({ distance: far })).bubble).toBe(0);
    // The viewer is not around at all (another room, not spawned yet).
    expect(overheadVisibility(sight({ distance: Infinity })).bubble).toBe(0);
    expect(overheadVisibility(sight({ distance: Number.NaN })).bubble).toBe(0);
  });

  test("it fades out over a short band past the radius", () => {
    const mid = overheadVisibility(sight({ distance: ACTIVITY_RADIUS + RADIUS_FADE / 2 })).bubble;
    expect(mid).toBeCloseTo(0.5, 5);
    let last = 1;
    for (let d = 0; d < ACTIVITY_RADIUS + RADIUS_FADE + 1; d += 0.1) {
      const v = overheadVisibility(sight({ distance: d })).bubble;
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
    expect(last).toBe(0);
  });

  test("under the cursor it shows at any distance", () => {
    expect(overheadVisibility(sight({ distance: far, hovered: true }))).toEqual({
      tag: 1,
      bubble: 1,
    });
  });

  test("'needs you' and 'answer ready' always show", () => {
    for (const kind of ["needs_you", "answer_ready"] as const) {
      for (const activityBubbles of [true, false]) {
        for (const reducedMotion of [true, false]) {
          const v = overheadVisibility(
            sight({ kind, distance: Infinity, activityBubbles, reducedMotion }),
          );
          expect(v.bubble).toBe(1);
        }
      }
    }
  });

  test("the 'Activity bubbles' setting off hides 'doing' everywhere, also under the cursor", () => {
    expect(overheadVisibility(sight({ activityBubbles: false })).bubble).toBe(0);
    expect(overheadVisibility(sight({ activityBubbles: false, hovered: true })).bubble).toBe(0);
    // The name tag does not follow that setting.
    expect(overheadVisibility(sight({ activityBubbles: false })).tag).toBe(1);
  });

  test("no bubble, nothing to show", () => {
    expect(overheadVisibility(sight({ kind: null })).bubble).toBe(0);
    expect(overheadVisibility(sight({ kind: "none", hovered: true })).bubble).toBe(0);
  });

  test("name tags follow the same rule at a longer radius", () => {
    expect(NAME_TAG_RADIUS).toBeGreaterThan(ACTIVITY_RADIUS);
    const between = (ACTIVITY_RADIUS + RADIUS_FADE + NAME_TAG_RADIUS) / 2;
    expect(overheadVisibility(sight({ distance: between }))).toEqual({ tag: 1, bubble: 0 });
    expect(overheadVisibility(sight({ distance: far })).tag).toBe(0);
    // A henchman that asks from across the room shows its bubble, not its name.
    expect(overheadVisibility(sight({ distance: far, kind: "needs_you" }))).toEqual({
      tag: 0,
      bubble: 1,
    });
  });

  test("the viewer's own agents keep their name tag at any distance, not their 'doing' bubble", () => {
    expect(overheadVisibility(sight({ distance: far, own: true }))).toEqual({ tag: 1, bubble: 0 });
    expect(overheadVisibility(sight({ distance: Infinity, own: true })).tag).toBe(1);
  });

  test("reduced motion: shown or hidden, never in between", () => {
    for (let d = 0; d < NAME_TAG_RADIUS + RADIUS_FADE + 1; d += 0.05) {
      const v = overheadVisibility(sight({ distance: d, reducedMotion: true }));
      expect([0, 1]).toContain(v.tag);
      expect([0, 1]).toContain(v.bubble);
      expect(v.bubble).toBe(d <= ACTIVITY_RADIUS ? 1 : 0);
      expect(v.tag).toBe(d <= NAME_TAG_RADIUS ? 1 : 0);
    }
    expect(nearness(ACTIVITY_RADIUS + 0.01, ACTIVITY_RADIUS, true)).toBe(0);
  });
});

describe("the fade over time", () => {
  test("takes FADE_SECONDS from hidden to shown and stops at the target", () => {
    let v = 0;
    const dt = FADE_SECONDS / 4;
    v = fadeToward(v, 1, dt, false);
    expect(v).toBeCloseTo(0.25, 5);
    for (let i = 0; i < 3; i++) v = fadeToward(v, 1, dt, false);
    expect(v).toBe(1);
    expect(fadeToward(1, 1, dt, false)).toBe(1);
    expect(fadeToward(1, 0, dt, false)).toBeCloseTo(0.75, 5);
    expect(fadeToward(0.1, 0, 10, false)).toBe(0);
    // A stalled or first frame does not move it.
    expect(fadeToward(0.4, 1, 0, false)).toBe(0.4);
  });

  test("reduced motion: no fade animation", () => {
    expect(fadeToward(0, 1, 0.001, true)).toBe(1);
    expect(fadeToward(1, 0, 0.001, true)).toBe(0);
    expect(fadeToward(0.3, 1, 0, true)).toBe(1);
  });
});
