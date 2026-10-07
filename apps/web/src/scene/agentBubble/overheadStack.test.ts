import { describe, expect, test } from "bun:test";
import { createOverheadField, solveStack } from "./overheadField.ts";
import { STACK_GAP_PX, type StackRect, stackedOverlap, stackOffsets } from "./overheadStack.ts";

const rect = (id: string, x: number, y: number, w = 200, h = 28): StackRect => ({
  id,
  x,
  y,
  w,
  h,
});

function noOverlaps(rects: StackRect[], offsets: Map<string, number>) {
  for (const a of rects)
    for (const b of rects) if (a.id < b.id) expect(stackedOverlap(a, b, offsets)).toBe(false);
}

describe("stacking the always-on bubbles (#283)", () => {
  test("bubbles that do not touch stay where they are", () => {
    const rects = [rect("a", 100, 300), rect("b", 400, 300), rect("c", 100, 200)];
    expect([...stackOffsets(rects).values()]).toEqual([0, 0, 0]);
  });

  test("of two that overlap, the lower one stays and the other moves just clear of it", () => {
    const rects = [rect("far", 150, 290), rect("near", 100, 300)];
    const offsets = stackOffsets(rects);
    expect(offsets.get("near")).toBe(0);
    // near's top edge is at 272; far's bottom goes a gap above it.
    expect(offsets.get("far")).toBe(290 - (300 - 28 - STACK_GAP_PX));
    noOverlaps(rects, offsets);
  });

  test("a pile at one desk block becomes a readable column", () => {
    const rects = ["a", "b", "c", "d", "e"].map((id, i) => rect(id, 500 + i * 6, 400 - i * 3));
    const offsets = stackOffsets(rects);
    noOverlaps(rects, offsets);
    const bottoms = rects.map((r) => r.y - (offsets.get(r.id) ?? 0)).sort((x, y) => y - x);
    for (let i = 1; i < bottoms.length; i++) {
      expect((bottoms[i - 1] as number) - (bottoms[i] as number)).toBe(28 + STACK_GAP_PX);
    }
  });

  test("a moved bubble does not land on a third one", () => {
    // b is pushed above a, where c already is: it has to clear c too.
    const rects = [rect("a", 100, 300), rect("b", 120, 295), rect("c", 140, 262)];
    const offsets = stackOffsets(rects);
    noOverlaps(rects, offsets);
    expect(offsets.get("a")).toBe(0);
  });

  test("bubbles of different sizes are kept apart too", () => {
    const rects = [rect("big", 300, 300, 320, 40), rect("small", 310, 280, 120, 22)];
    const offsets = stackOffsets(rects);
    noOverlaps(rects, offsets);
    expect(offsets.get("small")).toBe(280 - (300 - 40 - STACK_GAP_PX));
  });

  test("the result does not depend on the order they come in, and nothing ever moves down", () => {
    const rects = [rect("a", 100, 300), rect("b", 100, 300), rect("c", 110, 300)];
    const one = stackOffsets(rects);
    const two = stackOffsets([...rects].reverse());
    for (const r of rects) {
      expect(two.get(r.id)).toBe(one.get(r.id) as number);
      expect(one.get(r.id)).toBeGreaterThanOrEqual(0);
    }
    expect(one.get("a")).toBe(0);
    noOverlaps(rects, one);
  });

  test("64 henchmen all asking at once: every bubble is clear of every other", () => {
    // Eight rows of eight desks, seen from the room camera: neighbours 90 px apart, bubbles 230 px wide.
    const rects: StackRect[] = [];
    for (let i = 0; i < 64; i++) {
      const row = Math.floor(i / 8);
      rects.push(
        rect(`h${String(i).padStart(2, "0")}`, 700 + (i % 8) * 90 + row * 20, 150 + row * 45, 230),
      );
    }
    const offsets = stackOffsets(rects);
    expect(offsets.size).toBe(64);
    noOverlaps(rects, offsets);
  });
});

describe("the field stacks only what is drawn", () => {
  test("active slots get an offset; a hidden one is left out and reset", () => {
    const field = createOverheadField();
    const slot = (id: string, y: number, active: boolean) => {
      const s = { ...rect(id, 100, y), active, offset: 99 };
      field.slots.set(id, s);
      return s;
    };
    const a = slot("a", 300, true);
    const hidden = slot("hidden", 296, false);
    const b = slot("b", 292, true);
    solveStack(field);
    expect(a.offset).toBe(0);
    expect(hidden.offset).toBe(0);
    // b clears a, as if the hidden one were not there.
    expect(b.offset).toBe(292 - (300 - 28 - STACK_GAP_PX));

    field.slots.delete("a");
    solveStack(field);
    expect(b.offset).toBe(0);
  });
});
