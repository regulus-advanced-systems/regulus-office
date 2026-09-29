import { describe, expect, test } from "bun:test";
import { HEADING } from "./geometry.ts";
import { NavGrid } from "./nav-grid.ts";
import {
  CHAIR_SIZE,
  clearanceGrid,
  clusterGapProblems,
  freeFloorFraction,
  furnitureClusters,
  LANE_WIDTH,
  laneCells,
  laneProblems,
  MIN_FREE_FRACTION,
  rectGap,
  spacingProblems,
} from "./spacing.ts";
import { BIG_PLANT, perimeter, sharedTable, soloDesk } from "./templates/shared.ts";
import { TEMPLATES } from "./templates/tiers.ts";
import type { FloorTemplate, FloorTemplateInput } from "./types.ts";
import { parseFloorTemplate } from "./validate.ts";

const all = [...TEMPLATES.values()];

/** Plain 10 x 8 room with the elevator on the north wall and whatever furniture a test adds. */
function room(extra: Partial<FloorTemplateInput> = {}): FloorTemplate {
  return parseFloorTemplate({
    id: "t",
    name: "T",
    kind: "small",
    size: { width: 10, depth: 8 },
    wallHeight: 3,
    stubHeight: 0.4,
    walls: perimeter(10, 8),
    nameWallId: "south",
    elevator: {
      rect: { x: 4, z: 0, w: 2, d: 0.6 },
      wallId: "north",
      door: { x: 5, z: 1.25, heading: HEADING.south },
    },
    spawn: { x: 5, z: 1.25, heading: HEADING.south },
    seats: [],
    wallAnchors: [],
    obstacles: [],
    ...extra,
  });
}

describe("bundled templates are spacious (#118)", () => {
  test.each(all.map((t) => [t.id, t] as const))(
    "%s: every seat and interactable opens onto a lane at least 1.5 m wide",
    (_id, t) => {
      expect(LANE_WIDTH).toBe(1.5);
      expect(laneProblems(t)).toEqual([]);
    },
  );

  test.each(all.map((t) => [t.id, t] as const))(
    "%s: desk clusters are at least a lane apart",
    (_id, t) => {
      expect(clusterGapProblems(t)).toEqual([]);
    },
  );

  test.each(all.map((t) => [t.id, t] as const))(
    "%s: at least the minimum share of floor is free",
    (_id, t) => {
      expect(freeFloorFraction(t)).toBeGreaterThanOrEqual(MIN_FREE_FRACTION);
      expect(spacingProblems(t)).toEqual([]);
    },
  );

  test("one of each fixture and no duplicate storage", () => {
    for (const t of all) {
      const of = (kind: string) => t.obstacles.filter((o) => o.kind === kind);
      expect(of("cabinet").length).toBeLessThanOrEqual(1);
      expect(of("coffee_machine")).toHaveLength(1);
      expect(of("counter")).toHaveLength(1);
      if (t.kind !== "lobby") expect(of("fridge")).toHaveLength(1);
    }
  });

  test.each(all.map((t) => [t.id, t] as const))(
    "%s: lived-in (#118 review): plant groups, lounge pieces, rugs, wall decor, props",
    (_id, t) => {
      const of = (kind: string) => t.obstacles.filter((o) => o.kind === kind);
      const plants = [...of("plant"), ...of("plant_small")];
      expect(plants.length).toBeLessThanOrEqual(12);
      expect(of("plant").some((p) => p.rect.w === BIG_PLANT)).toBe(true);
      // At least one grouping: a small pot within 1.5 m of a bigger plant.
      const grouped = of("plant_small").some((s) =>
        of("plant").some((p) => rectGap(p.rect, s.rect) <= 1.5),
      );
      expect(grouped).toBe(true);
      for (const kind of ["armchair", "floor_lamp", "bookshelf"]) {
        expect(of(kind).length).toBeGreaterThanOrEqual(1);
      }
      expect(t.rugs.filter((r) => r.style === "rug").length).toBeGreaterThanOrEqual(2);
      expect(t.rugs.filter((r) => r.style === "patch").length).toBeGreaterThanOrEqual(1);
      expect(t.wallDecor.length).toBeGreaterThanOrEqual(3);
      expect(t.decor.length).toBeGreaterThanOrEqual(2);

      const onRug = (p: { x: number; z: number }, style: "rug" | "patch") =>
        t.rugs.some(
          (r) =>
            r.style === style &&
            p.x >= r.rect.x &&
            p.x <= r.rect.x + r.rect.w &&
            p.z >= r.rect.z &&
            p.z <= r.rect.z + r.rect.d,
        );
      // A runner leads from the elevator; the coffee corner has its own floor.
      expect(onRug(t.elevator.door, "rug")).toBe(true);
      const coffee = of("coffee_machine")[0]?.standAt;
      expect(coffee && onRug(coffee, "patch")).toBe(true);
      // Every shared table (desk pod) stands on a rug.
      for (const table of of("shared_table")) {
        const c = { x: table.rect.x + table.rect.w / 2, z: table.rect.z + table.rect.d / 2 };
        expect(onRug(c, "rug")).toBe(true);
      }
    },
  );

  test.each(all.filter((t) => t.kind !== "lobby").map((t) => [t.id, t] as const))(
    "%s: the meeting table sits in front of the boards (collaboration zone)",
    (_id, t) => {
      const meeting = t.obstacles.find((o) => o.kind === "meeting_table");
      const board = t.wallAnchors.find((a) => a.kind === "whiteboard");
      expect(meeting && board).toBeTruthy();
      if (!meeting || !board) return;
      // Boards hang on the west wall; the meeting table is the nearest desk-like cluster to them.
      expect(board.wallId).toBe("west");
      const cz = meeting.rect.z + meeting.rect.d / 2;
      expect(Math.abs(cz - board.t)).toBeLessThan(2);
      const clusters = furnitureClusters(t);
      const nearestToWest = [...clusters].sort((a, b) => a.rect.x - b.rect.x)[0];
      expect(nearestToWest?.ids).toContain(meeting.id);
    },
  );
});

describe("clearance grid", () => {
  test("chairs take floor even though the nav grid lets avatars sit on them", () => {
    const t = room({
      seats: [{ id: "s", kind: "chair", pose: { x: 5.1, z: 5.1, heading: HEADING.north } }],
    });
    const grid = clearanceGrid(t);
    expect(grid.isWalkable(5.1, 5.1)).toBe(false);
    expect(grid.isWalkable(5.1 + CHAIR_SIZE, 5.1)).toBe(true);
  });

  test("free fraction drops as furniture is added", () => {
    const empty = freeFloorFraction(room());
    const furnished = freeFloorFraction(room(sharedTable("tab", 3, 3)));
    expect(empty).toBeGreaterThan(0.85);
    expect(furnished).toBeLessThan(empty);
  });
});

describe("laneCells", () => {
  test("marks only cells a 1.5 m square fits through", () => {
    const grid = new NavGrid(4, 1.5, 0.25);
    // Block a 1 m wide pillar in the middle: the corridor is 1.5 m deep but split.
    grid.blockRect({ x: 1.75, z: 0, w: 0.5, d: 0.5 });
    const lane = laneCells(grid);
    const at = (x: number, z: number) => lane[grid.index(grid.worldToCell(x, z))] === 1;
    expect(at(0.5, 0.5)).toBe(true);
    expect(at(3.5, 1.25)).toBe(true);
    expect(at(2, 1.25)).toBe(false);
  });
});

describe("laneProblems", () => {
  test("a desk wedged against the wall is reported", () => {
    const desk = soloDesk("d", 1, 6);
    const t = room({ obstacles: desk.obstacles, seats: desk.seats });
    // Seat at z 7.25, 0.75 m from the south wall, but a lane still passes north of the desk.
    expect(laneProblems(t)).toEqual([]);
    const boxedIn = room({
      obstacles: [
        ...desk.obstacles,
        { id: "wall-block", kind: "cabinet", rect: { x: 1.8, z: 5, w: 0.5, d: 2.9 } },
        { id: "top-block", kind: "cabinet", rect: { x: 0.1, z: 5, w: 1.7, d: 0.5 } },
      ],
      seats: desk.seats,
    });
    expect(laneProblems(boxedIn)).toContain('seat "d-seat" is not within 1 m of a 1.5 m lane');
  });
});

describe("furniture clusters", () => {
  test("a table grows over its chairs and the CEO L-desk is one cluster", () => {
    const t = room({
      obstacles: [
        ...sharedTable("tab", 1, 2).obstacles,
        { id: "ceo-main", kind: "ceo_desk", rect: { x: 6, z: 2, w: 2.4, d: 0.8 } },
        { id: "ceo-return", kind: "ceo_desk", rect: { x: 7.6, z: 2.8, w: 0.8, d: 1.6 } },
      ],
      seats: sharedTable("tab", 1, 2).seats,
    });
    const clusters = furnitureClusters(t);
    expect(clusters.map((c) => c.ids)).toEqual([["tab"], ["ceo-main", "ceo-return"]]);
    const table = clusters[0];
    expect(table?.rect.z).toBeCloseTo(2 - 0.5 - CHAIR_SIZE / 2, 9);
    // North chairs 0.5 m and south chairs 2 m from the table's north edge.
    expect(table?.rect.d).toBeCloseTo(2 + CHAIR_SIZE / 2 - (-0.5 - CHAIR_SIZE / 2), 9);
  });

  test("clusters closer than a lane are reported", () => {
    const a = soloDesk("a", 2, 3);
    const b = soloDesk("b", 4, 3);
    const t = room({
      obstacles: [...a.obstacles, ...b.obstacles],
      seats: [...a.seats, ...b.seats],
    });
    expect(clusterGapProblems(t)).toEqual(['"a" and "b" are 0.40 m apart']);
  });

  test("rectGap is the larger axis gap and negative on overlap", () => {
    expect(rectGap({ x: 0, z: 0, w: 1, d: 1 }, { x: 3, z: 0.5, w: 1, d: 1 })).toBe(2);
    expect(rectGap({ x: 0, z: 0, w: 2, d: 2 }, { x: 1, z: 1, w: 2, d: 2 })).toBe(-1);
  });
});
