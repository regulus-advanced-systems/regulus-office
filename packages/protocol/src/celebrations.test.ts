import { describe, expect, test } from "bun:test";
import { GONG_CAUSES, GONG_STRIKES, GongRing, PrMerged } from "./celebrations.ts";

describe("merge gong messages (#43)", () => {
  test("pr.merged carries the PR and its operation", () => {
    const ok = { operationId: "f1", repoId: "r1", number: 8, title: "Oil", url: "", at: 1 };
    expect(PrMerged.parse(ok)).toEqual(ok);
    expect(PrMerged.safeParse({ ...ok, number: 0 }).success).toBe(false);
    expect(PrMerged.safeParse({ ...ok, title: "x".repeat(301) }).success).toBe(false);
  });

  test("gong.ring: one strike for a merge or a bang, three when the queue empties", () => {
    expect(GONG_CAUSES.map((c) => GONG_STRIKES[c])).toEqual([1, 1, 3]);
    const ring = { operationId: "f1", cause: "queue_empty" as const, strikes: 3, at: 1 };
    expect(GongRing.parse(ring)).toEqual(ring);
    expect(GongRing.safeParse({ ...ring, strikes: 4 }).success).toBe(false);
    expect(GongRing.safeParse({ ...ring, cause: "party" }).success).toBe(false);
  });
});
