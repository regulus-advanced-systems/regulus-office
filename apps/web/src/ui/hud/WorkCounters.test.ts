import { describe, expect, test } from "bun:test";
import { shownCounts } from "./WorkCounters.tsx";

describe("work counters", () => {
  test("hold back bubbles still in the air, never below zero", () => {
    expect(
      shownCounts(
        { toolCalls: 10, fileEdits: 3, testRuns: 1, toolFailures: 0 },
        { toolCalls: 4, fileEdits: 0, testRuns: 2, toolFailures: 0 },
      ),
    ).toEqual({ toolCalls: 6, fileEdits: 3, testRuns: 0, toolFailures: 0 });
  });
});
