import { describe, expect, test } from "bun:test";
import type { BubbleEmits } from "@regulus/protocol";
import {
  bubbleDelta,
  bubblesFor,
  MAX_BUBBLES_PER_UPDATE,
  sumBubbleEmits,
  zeroDelta,
} from "./bubbleEmits.ts";
import { BubblePool } from "./bubblePool.ts";
import { BubbleQueue, EMIT_INTERVAL_MS, MAX_QUEUED_PER_HENCHMAN } from "./bubbleQueue.ts";
import {
  BUBBLE_LIFETIME,
  bubbleScale,
  flyPosition,
  RISE_HEIGHT,
  RISE_SECONDS,
  risePosition,
} from "./trajectory.ts";

const emits = (toolCalls: number, fileEdits = 0, testRuns = 0, toolFailures = 0): BubbleEmits => ({
  toolCalls,
  fileEdits,
  testRuns,
  toolFailures,
});

describe("bubble emission from counter deltas", () => {
  test("a henchman seen for the first time emits nothing", () => {
    expect(bubbleDelta(undefined, emits(40, 12, 3, 1))).toEqual(zeroDelta());
  });

  test("increments become bubbles of the matching kind", () => {
    const delta = bubbleDelta(emits(10, 2, 1, 0), emits(12, 3, 1, 1));
    expect(delta).toEqual({ toolCalls: 2, fileEdits: 1, testRuns: 0, toolFailures: 1 });
    expect(bubblesFor(delta)).toEqual(["toolCalls", "fileEdits", "toolFailures", "toolCalls"]);
  });

  test("a counter reset (new task, re-adopted agent) emits nothing", () => {
    expect(bubbleDelta(emits(30, 5), emits(2, 0))).toEqual(zeroDelta());
  });

  test("bursts are capped and round-robin so rare kinds still show", () => {
    const kinds = bubblesFor({ toolCalls: 50, fileEdits: 0, testRuns: 0, toolFailures: 1 });
    expect(kinds).toHaveLength(MAX_BUBBLES_PER_UPDATE);
    expect(kinds).toContain("toolFailures");
    expect(bubblesFor(zeroDelta())).toEqual([]);
  });

  test("operation totals add up every henchman", () => {
    expect(
      sumBubbleEmits([{ bubbleEmits: emits(1, 2) }, { bubbleEmits: emits(3, 0, 1, 1) }]),
    ).toEqual({ toolCalls: 4, fileEdits: 2, testRuns: 1, toolFailures: 1 });
  });
});

describe("bubble queue", () => {
  test("one bubble per henchman per interval", () => {
    const q = new BubbleQueue();
    q.push("a1", ["toolCalls", "fileEdits"], 0);
    q.push("a2", ["testRuns"], 0);
    expect(q.due(0)).toEqual([
      { agentId: "a1", kind: "toolCalls" },
      { agentId: "a2", kind: "testRuns" },
    ]);
    expect(q.due(EMIT_INTERVAL_MS - 1)).toEqual([]);
    expect(q.due(EMIT_INTERVAL_MS)).toEqual([{ agentId: "a1", kind: "fileEdits" }]);
    expect(q.size).toBe(0);
  });

  test("the backlog per henchman is bounded; the overflow is reported", () => {
    const q = new BubbleQueue();
    const many = Array.from({ length: MAX_QUEUED_PER_HENCHMAN + 3 }, () => "toolCalls" as const);
    expect(q.push("a1", many, 0)).toHaveLength(3);
    expect(q.size).toBe(MAX_QUEUED_PER_HENCHMAN);
    expect(q.drop("a1")).toHaveLength(MAX_QUEUED_PER_HENCHMAN);
    expect(q.size).toBe(0);
  });
});

describe("bubble pool and trajectory", () => {
  test("the pool is capped and slots are reused", () => {
    const pool = new BubblePool(2);
    const o = { x: 1, y: 1, z: 1 };
    const a = pool.acquire("toolCalls", o, 1);
    expect(pool.acquire("fileEdits", o, 2)).not.toBeNull();
    expect(pool.acquire("testRuns", o, 3)).toBeNull();
    if (a) pool.release(a);
    expect(pool.size).toBe(1);
    expect(pool.acquire("testRuns", o, 4)?.kind).toBe("testRuns");
    pool.clear();
    expect(pool.active()).toEqual([]);
  });

  test("bubbles rise above the laptop, then reach the target at the end of life", () => {
    const from = { x: 2, y: 1, z: 3 };
    const p = { x: 0, y: 0, z: 0 };
    risePosition(from, RISE_SECONDS, 0, p);
    expect(p.y).toBeCloseTo(from.y + 0.15 + RISE_HEIGHT, 5);
    const target = { x: 10, y: 20, z: -5 };
    flyPosition(p, target, BUBBLE_LIFETIME, p);
    expect(p).toEqual(target);
    expect(bubbleScale(0)).toBeLessThan(1);
    expect(bubbleScale(RISE_SECONDS / 2)).toBe(1);
  });
});
