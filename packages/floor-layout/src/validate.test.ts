import { describe, expect, test } from "bun:test";
import { HEADING } from "./geometry.ts";
import { officeL2TemplateInput } from "./templates/office-l2.ts";
import { perimeter } from "./templates/shared.ts";
import type { FloorTemplateInput } from "./types.ts";
import { loadTemplate, parseFloorTemplate, structuralProblems, TemplateError } from "./validate.ts";

/** Tiny valid room: 4 x 4 m, elevator on the north wall, one desk seat. */
function tinyRoom(overrides: Partial<FloorTemplateInput> = {}): FloorTemplateInput {
  return {
    id: "tiny",
    name: "Tiny",
    kind: "small",
    size: { width: 4, depth: 4 },
    wallHeight: 3,
    stubHeight: 0.4,
    walls: perimeter(4, 4, { north: [{ kind: "window", t: 0.5, w: 0.5 }] }),
    nameWallId: "south",
    elevator: {
      rect: { x: 1.5, z: 0, w: 1, d: 0.5 },
      wallId: "north",
      door: { x: 2.25, z: 1.25, heading: HEADING.south },
    },
    spawn: { x: 2.25, z: 1.25, heading: HEADING.south },
    wallAnchors: [
      { id: "board", kind: "issue_board", wallId: "west", t: 2.25, y: 1.5, w: 1, h: 1 },
    ],
    obstacles: [{ id: "desk", kind: "desk", rect: { x: 1, z: 2.5, w: 1, d: 0.5 } }],
    seats: [
      {
        id: "seat",
        kind: "desk",
        furnitureId: "desk",
        pose: { x: 1.25, z: 3.25, heading: HEADING.north },
      },
    ],
    ...overrides,
  };
}

function problemsOf(input: FloorTemplateInput): string[] {
  try {
    loadTemplate(input);
    return [];
  } catch (e) {
    if (e instanceof TemplateError) return [...e.problems];
    throw e;
  }
}

describe("loadTemplate", () => {
  test("accepts a sound template and applies defaults", () => {
    const t = loadTemplate(tinyRoom());
    expect(t.wallAnchors[0]?.approach).toBe(0.75);
    expect(t.walls.every((w) => Array.isArray(w.openings))).toBe(true);
  });

  test("rejects malformed input with a zod error", () => {
    expect(() => parseFloorTemplate({ ...tinyRoom(), kind: "huge" })).toThrow();
    expect(() => loadTemplate({ ...tinyRoom(), wallAnchors: [{ id: "x" }] } as never)).toThrow();
    expect(() => parseFloorTemplate({ ...tinyRoom(), size: { width: -1, depth: 4 } })).toThrow();
  });

  test("rejects duplicate ids", () => {
    const seat = { id: "seat", kind: "desk" as const, pose: { x: 2.75, z: 3.25, heading: 0 } };
    const p = problemsOf(tinyRoom({ seats: [...tinyRoom().seats, seat] }));
    expect(p).toContain('duplicate seat id "seat"');
  });

  test("rejects anchors that leave their wall, hang on a stub or unknown wall, or cover a window", () => {
    const base = tinyRoom().wallAnchors[0];
    if (!base) throw new Error("fixture");
    expect(problemsOf(tinyRoom({ wallAnchors: [{ ...base, t: 3.8 }] }))).toContain(
      'anchor "board" hangs past the ends of wall "west"',
    );
    expect(problemsOf(tinyRoom({ wallAnchors: [{ ...base, y: 2.8 }] }))).toContain(
      'anchor "board" does not fit the height of wall "west"',
    );
    expect(
      problemsOf(tinyRoom({ wallAnchors: [{ ...base, wallId: "south", y: 0.2, h: 0.2 }] })),
    ).toContain('anchor "board" must hang on a full wall (wall "south" is a stub)');
    expect(problemsOf(tinyRoom({ wallAnchors: [{ ...base, wallId: "ceiling" }] }))).toContain(
      'anchor "board" references unknown wall "ceiling"',
    );
    expect(
      problemsOf(tinyRoom({ wallAnchors: [{ ...base, wallId: "north", t: 0.75 }] })),
    ).toContain('anchor "board" overlaps a window on wall "north"');
    expect(problemsOf(tinyRoom({ wallAnchors: [{ ...base, wallId: "north", t: 2 }] }))).toContain(
      'anchor "board" overlaps the elevator doors',
    );
    expect(
      problemsOf(tinyRoom({ wallAnchors: [base, { ...base, id: "board2", t: 2.5 }] })),
    ).toContain('anchors "board" and "board2" overlap on wall "west"');
  });

  test("rejects a seat on a blocked cell and an unreachable seat", () => {
    const blocked = tinyRoom({
      seats: [{ id: "seat", kind: "desk", pose: { x: 1.25, z: 2.75, heading: 0 } }],
    });
    expect(problemsOf(blocked)).toContain('seat "seat" is on a blocked cell');

    const walledOff = tinyRoom({
      obstacles: [
        ...tinyRoom().obstacles,
        { id: "bar", kind: "cabinet", rect: { x: 0, z: 2.5, w: 4, d: 0.5 } },
      ],
    });
    expect(problemsOf(walledOff)).toEqual(['seat "seat" is unreachable from spawn']);
  });

  test("rejects a blocked spawn point and interactables on blocked cells", () => {
    expect(problemsOf(tinyRoom({ spawn: { x: 0.25, z: 0.25, heading: 0 } }))).toEqual([
      "spawn point is on a blocked cell",
    ]);
    const jammed = tinyRoom({
      obstacles: [
        ...tinyRoom().obstacles,
        { id: "box", kind: "plant", rect: { x: 0.6, z: 2, w: 0.4, d: 0.5 } },
      ],
    });
    expect(problemsOf(jammed)).toContain('issue_board "board" is on a blocked cell');
  });

  test("rejects bad references and geometry", () => {
    expect(problemsOf(tinyRoom({ nameWallId: "north" }))).toContain(
      'name wall "north" must be a stub wall',
    );
    expect(
      problemsOf(tinyRoom({ elevator: { ...tinyRoom().elevator, wallId: "east" } })),
    ).toContain("elevator must be set into a full wall");
    expect(
      problemsOf(
        tinyRoom({
          seats: [
            {
              id: "s",
              kind: "chair",
              furnitureId: "ghost",
              pose: { x: 2.25, z: 2.25, heading: 0 },
            },
          ],
        }),
      ),
    ).toContain('seat "s" references unknown furniture "ghost"');
    expect(
      problemsOf(
        tinyRoom({ obstacles: [{ id: "o", kind: "plant", rect: { x: 3.8, z: 1, w: 1, d: 1 } }] }),
      ),
    ).toContain('obstacle "o" leaves the room');
    const diagonal = tinyRoom();
    diagonal.walls = [
      ...diagonal.walls,
      { id: "diag", from: { x: 1, z: 1 }, to: { x: 2, z: 2 }, height: "full", facing: "east" },
    ];
    expect(problemsOf(diagonal)).toContain('wall "diag" is not axis-aligned');
  });

  test("structuralProblems is empty for the shipped medium template", () => {
    expect(structuralProblems(parseFloorTemplate(officeL2TemplateInput))).toEqual([]);
  });
});
