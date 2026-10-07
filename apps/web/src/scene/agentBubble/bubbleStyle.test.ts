import { describe, expect, test } from "bun:test";
import { type AgentBubble, NO_AGENT_BUBBLE } from "@regulus/protocol";
import {
  ACTIVITY_FADE,
  BUBBLE_LOOKS,
  BUBBLE_MAX_CHARS,
  bobOffset,
  bubbleBobs,
  bubbleClickable,
  bubbleLabel,
  distanceFade,
  labelWorldHeight,
  NAME_TAG,
  nameLabel,
  visibleBubble,
} from "./bubbleStyle.ts";

const doing: AgentBubble = {
  kind: "doing",
  text: "reading auth.ts",
  targetKind: "none",
  targetId: "",
};
const asks: AgentBubble = {
  kind: "needs_you",
  text: "waiting for you: approve a command",
  targetKind: "permission",
  targetId: "a1",
};
const ready: AgentBubble = {
  kind: "answer_ready",
  text: "finished: take a look",
  targetKind: "terminal",
  targetId: "a1",
};

describe("which bubble a viewer sees", () => {
  test("everything by default; nothing for an empty bubble", () => {
    const on = { activityBubbles: true };
    expect(visibleBubble(doing, on)).toBe(doing);
    expect(visibleBubble(asks, on)).toBe(asks);
    expect(visibleBubble(NO_AGENT_BUBBLE, on)).toBeNull();
    expect(visibleBubble(undefined, on)).toBeNull();
    expect(visibleBubble({ ...doing, text: "" }, on)).toBeNull();
  });

  test("with activity bubbles hidden, 'needs you' and 'answer ready' stay", () => {
    const off = { activityBubbles: false };
    expect(visibleBubble(doing, off)).toBeNull();
    expect(visibleBubble(asks, off)).toBe(asks);
    expect(visibleBubble(ready, off)).toBe(ready);
  });

  test("only a bubble that asks and names a target can be clicked", () => {
    expect(bubbleClickable(asks)).toBe(true);
    expect(bubbleClickable(ready)).toBe(true);
    expect(bubbleClickable(doing)).toBe(false);
    expect(bubbleClickable({ ...asks, targetKind: "none" })).toBe(false);
    expect(bubbleClickable({ ...doing, targetKind: "terminal", targetId: "a1" })).toBe(false);
    expect(bubbleClickable(null)).toBe(false);
  });
});

describe("how it looks", () => {
  test("the name tag is quieter and smaller than any bubble; 'needs you' is the loudest", () => {
    for (const look of Object.values(BUBBLE_LOOKS)) {
      expect(NAME_TAG.screenPx).toBeLessThan(look.screenPx);
      expect(NAME_TAG.opacity).toBeLessThan(look.opacity);
    }
    expect(BUBBLE_LOOKS.needs_you.screenPx).toBeGreaterThan(BUBBLE_LOOKS.doing.screenPx);
    expect(BUBBLE_LOOKS.doing.badge).toBe("");
    expect(BUBBLE_LOOKS.needs_you.badge).toBe("!");
  });

  test("labels are one line and capped", () => {
    expect(bubbleLabel("  reading\n auth.ts ")).toBe("reading auth.ts");
    const long = bubbleLabel("x".repeat(80));
    expect(long).toHaveLength(BUBBLE_MAX_CHARS);
    expect(long.endsWith("…")).toBe(true);
    expect(nameLabel("Gasket")).toBe("Gasket");
  });

  test("labels keep a readable size on screen from the room framing out, their own size up close", () => {
    const view = { distance: 30, fovDeg: 40, viewportPx: 1080 };
    const label = { screenPx: 24, worldHeight: 0.26 };
    const h = labelWorldHeight(label, view);
    // 24 px of a 1080 px viewport that shows about 21.8 m at 30 m.
    expect(h).toBeCloseTo((24 / 1080) * 2 * 30 * Math.tan((20 * Math.PI) / 180), 5);
    expect(labelWorldHeight(label, { ...view, distance: 60 })).toBeCloseTo(h * 2, 5);
    // Close up it is an object in the room: no smaller than its world height.
    expect(labelWorldHeight(label, { ...view, distance: 8 })).toBe(0.26);
    expect(labelWorldHeight(label, { ...view, distance: 0.5 })).toBe(0.26);
    expect(labelWorldHeight(label, { ...view, distance: 5000 })).toBe(1.6);
    // Every label is on its screen size at the default room framing (30 m, 1080p).
    for (const l of [NAME_TAG, ...Object.values(BUBBLE_LOOKS)]) {
      expect(labelWorldHeight(l, view)).toBeGreaterThan(l.worldHeight);
    }
  });

  test("labels fade out towards the overview", () => {
    expect(distanceFade(30, ACTIVITY_FADE)).toBe(1);
    expect(distanceFade(ACTIVITY_FADE.to, ACTIVITY_FADE)).toBe(0);
    const mid = distanceFade((ACTIVITY_FADE.from + ACTIVITY_FADE.to) / 2, ACTIVITY_FADE);
    expect(mid).toBeCloseTo(0.5, 5);
    expect(distanceFade(Number.NaN, ACTIVITY_FADE)).toBe(1);
  });

  test("only 'needs you' moves, and not with reduced motion or on the low preset", () => {
    expect(bubbleBobs("needs_you", { still: false })).toBe(true);
    expect(bubbleBobs("needs_you", { still: true })).toBe(false);
    expect(bubbleBobs("doing", { still: false })).toBe(false);
    expect(bubbleBobs("answer_ready", { still: false })).toBe(false);
    for (let t = 0; t < 10; t += 0.37) expect(Math.abs(bobOffset(t))).toBeLessThanOrEqual(0.07);
  });
});
