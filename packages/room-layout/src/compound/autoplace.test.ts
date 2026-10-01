import { describe, expect, test } from "bun:test";
import {
  findPlacement,
  legacyRoomSize,
  planMigration,
  type ReconcileInput,
  reconcilePlacements,
  rowSlot,
} from "./autoplace.ts";
import { type CompoundRoomInput, computeCompoundLayout } from "./layout.ts";
import { defaultCompoundSpec, mainCorridor } from "./special.ts";
import { int, layoutViolations, randomCompound, rng } from "./test-support.ts";
import { layoutProblems } from "./validate.ts";

const spec = defaultCompoundSpec();

const legacy = (n: number, seed = 1): ReconcileInput[] => {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => ({
    id: `operation-${String(i).padStart(2, "0")}`,
    placement: null,
    size: legacyRoomSize([6, 12, 20][int(r, 0, 2)] ?? 12),
  }));
};

const asInputs = (m: ReadonlyMap<string, CompoundRoomInput["placement"]>) =>
  [...m].map(([id, placement]) => ({ id, placement }));

describe("legacy room sizes", () => {
  test("follow the old tier's desk seats", () => {
    expect(legacyRoomSize(6)).toEqual({ width: 8, depth: 8 });
    expect(legacyRoomSize(12)).toEqual({ width: 10, depth: 10 });
    expect(legacyRoomSize(20)).toEqual({ width: 12, depth: 12 });
  });
});

describe("rows off the main corridor", () => {
  test("the first migrated rooms sit in one row on the main corridor, doors south", () => {
    const { result } = planMigration(spec, legacy(3));
    expect(result.unplaced).toEqual([]);
    const corridorTop = mainCorridor(spec).y;
    for (const p of result.placements.values()) {
      expect(p.doorSide).toBe("south");
      expect(p.gridY + p.depth).toBe(corridorTop);
    }
  });

  test.each([1, 4, 9, 14, 20])("%d operations migrate into a valid compound", (n) => {
    const { spec: grown, result } = planMigration(spec, legacy(n, n));
    expect(result.unplaced).toEqual([]);
    expect(result.changed).toHaveLength(n);
    const rooms = asInputs(result.placements);
    expect(layoutProblems(grown, rooms)).toEqual([]);
    expect(layoutViolations(computeCompoundLayout(grown, rooms))).toEqual([]);
  });

  test("the compound grows when the operations do not fit, and only then", () => {
    expect(planMigration(spec, legacy(6)).spec).toEqual(spec);
    // 18 operations do not fit the default 64 tiles; one growth step does.
    const many = planMigration(spec, legacy(18, 3));
    expect(many.result.unplaced).toEqual([]);
    expect(many.spec.width).toBeGreaterThan(64);
    expect(many.spec.lobby.y + many.spec.lobby.d).toBe(many.spec.depth);
    // The size it settles on is laid out in full, as a plain reconcile would.
    const plain = reconcilePlacements(many.spec, legacy(18, 3));
    expect([...many.result.placements]).toEqual([...plain.placements]);
  });

  test("stopAtUnplaced gives up at the first room that does not fit", () => {
    const small = defaultCompoundSpec(48);
    const rooms = legacy(30, 9);
    const quick = reconcilePlacements(small, rooms, { stopAtUnplaced: true });
    const ids = rooms.map((r) => r.id);
    const first = quick.changed.length;
    expect(quick.unplaced.length).toBeGreaterThan(0);
    expect(quick.changed).toEqual(ids.slice(0, first));
    expect(quick.unplaced).toEqual(ids.slice(first));
    const next = rooms[first];
    if (!next) throw new Error("no unplaced room");
    expect(findPlacement(small, asInputs(quick.placements), next.id, next.size)).toBeNull();
  });

  test("migration is deterministic", () => {
    const a = planMigration(spec, legacy(11, 5));
    const b = planMigration(spec, legacy(11, 5));
    expect([...b.result.placements]).toEqual([...a.result.placements]);
  });

  test("rowSlot never returns an invalid spot", () => {
    const rooms = randomCompound(77, spec, 6);
    const slot = rowSlot(spec, rooms, "new", { width: 10, depth: 10 });
    if (slot) expect(layoutProblems(spec, [...rooms, { id: "new", placement: slot }])).toEqual([]);
  });
});

describe("reconcile", () => {
  test.each([11, 12, 13, 14, 15])("seed %d: valid rooms keep their spot", (seed) => {
    const rooms = randomCompound(seed, spec, 8);
    const input: ReconcileInput[] = [
      ...rooms.map((r) => ({ ...r, size: { width: r.placement.width, depth: r.placement.depth } })),
      { id: "zz-new", placement: null, size: { width: 8, depth: 8 } },
    ];
    const result = reconcilePlacements(spec, input);
    for (const r of rooms) expect(result.placements.get(r.id)).toEqual(r.placement);
    expect(result.changed).toEqual(result.unplaced.length ? [] : ["zz-new"]);
    expect(layoutProblems(spec, asInputs(result.placements))).toEqual([]);
  });

  test("a room restored onto a built-over spot is moved, earlier rooms win", () => {
    const a = {
      id: "a",
      placement: { gridX: 26, gridY: 44, width: 10, depth: 10, doorSide: "south" as const },
    };
    const restored = { id: "b", placement: { ...a.placement, gridX: 28 } };
    const result = reconcilePlacements(spec, [
      { ...a, size: { width: 10, depth: 10 } },
      { ...restored, size: { width: 10, depth: 10 } },
    ]);
    expect(result.placements.get("a")).toEqual(a.placement);
    expect(result.changed).toEqual(["b"]);
    expect(layoutProblems(spec, asInputs(result.placements))).toEqual([]);
  });

  test("a full compound leaves the extra room unplaced", () => {
    const small = defaultCompoundSpec(48);
    const result = reconcilePlacements(small, legacy(30, 9));
    expect(result.unplaced.length).toBeGreaterThan(0);
    expect(layoutProblems(small, asInputs(result.placements))).toEqual([]);
  });
});

describe("findPlacement", () => {
  test("finds the nearest valid spot, or null when nothing fits", () => {
    const p = findPlacement(spec, [], "x", { width: 6, depth: 6 });
    expect(p).not.toBeNull();
    if (p) expect(layoutProblems(spec, [{ id: "x", placement: p }])).toEqual([]);
    const tiny = { ...defaultCompoundSpec(48) };
    const crowd = reconcilePlacements(tiny, legacy(40, 2));
    expect(
      findPlacement(tiny, asInputs(crowd.placements), "y", { width: 12, depth: 12 }),
    ).toBeNull();
  });
});
