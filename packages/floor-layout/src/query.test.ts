import { describe, expect, test } from "bun:test";
import { HEADING, headingFacing, headingToward, rectsOverlap, segmentRect } from "./geometry.ts";
import { anchorStandPose, interactables, rectSpanOnWall, wallPoint } from "./query.ts";
import { lobbyTemplate } from "./templates/lobby.ts";
import type { Wall, WallAnchor } from "./types.ts";

const anchor: WallAnchor = {
  id: "a",
  kind: "picture",
  wallId: "w",
  t: 2,
  y: 1.5,
  w: 1,
  h: 1,
  approach: 0.75,
};

function wall(from: Wall["from"], to: Wall["to"], facing: Wall["facing"]): Wall {
  return { id: "w", from, to, height: "full", facing, openings: [] };
}

describe("headings", () => {
  test("compass headings match three.js rotation.y with -z forward", () => {
    expect(headingFacing({ x: 0, z: -1 })).toBeCloseTo(HEADING.north);
    expect(headingFacing({ x: 0, z: 1 })).toBeCloseTo(HEADING.south);
    expect(headingFacing({ x: 1, z: 0 })).toBeCloseTo(HEADING.east);
    expect(headingFacing({ x: -1, z: 0 })).toBeCloseTo(HEADING.west);
    expect(headingToward({ x: 1, z: 1 }, { x: 1, z: 5 })).toBeCloseTo(HEADING.south);
  });
});

describe("anchorStandPose", () => {
  test("stands in front of a north wall looking north", () => {
    const pose = anchorStandPose(wall({ x: 0, z: 0 }, { x: 10, z: 0 }, "south"), anchor);
    expect(pose.x).toBeCloseTo(2);
    expect(pose.z).toBeCloseTo(0.75);
    expect(pose.heading).toBeCloseTo(HEADING.north);
  });

  test("stands in front of a west wall looking west", () => {
    const pose = anchorStandPose(wall({ x: 0, z: 0 }, { x: 0, z: 10 }, "east"), anchor);
    expect(pose.x).toBeCloseTo(0.75);
    expect(pose.z).toBeCloseTo(2);
    expect(pose.heading).toBeCloseTo(HEADING.west);
  });

  test("respects the anchor's approach distance and a partition facing west", () => {
    const pose = anchorStandPose(wall({ x: 5, z: 1 }, { x: 5, z: 8 }, "west"), {
      ...anchor,
      approach: 1.25,
    });
    expect(pose.x).toBeCloseTo(3.75);
    expect(pose.z).toBeCloseTo(3);
    expect(pose.heading).toBeCloseTo(HEADING.east);
  });
});

describe("geometry helpers", () => {
  test("wallPoint and rectSpanOnWall project along the wall", () => {
    const w = wall({ x: 0, z: 0 }, { x: 10, z: 0 }, "south");
    expect(wallPoint(w, 4)).toEqual({ x: 4, z: 0 });
    expect(rectSpanOnWall(w, { x: 3, z: 0, w: 2, d: 0.5 })).toEqual({ start: 3, end: 5 });
    const reversed = wall({ x: 10, z: 0 }, { x: 0, z: 0 }, "south");
    expect(rectSpanOnWall(reversed, { x: 3, z: 0, w: 2, d: 0.5 })).toEqual({ start: 5, end: 7 });
  });

  test("segmentRect thickens a segment symmetrically", () => {
    expect(segmentRect({ x: 0, z: 0 }, { x: 0, z: 4 }, 0.2)).toEqual({
      x: -0.1,
      z: -0.1,
      w: 0.2,
      d: 4.2,
    });
  });

  test("rectsOverlap ignores touching edges", () => {
    expect(rectsOverlap({ x: 0, z: 0, w: 1, d: 1 }, { x: 1, z: 0, w: 1, d: 1 })).toBe(false);
    expect(rectsOverlap({ x: 0, z: 0, w: 1, d: 1 }, { x: 0.9, z: 0.9, w: 1, d: 1 })).toBe(true);
  });
});

describe("interactables", () => {
  test("lists the elevator first, then anchors, then obstacles with a stand point", () => {
    const list = interactables(lobbyTemplate);
    expect(list[0]).toEqual({
      id: "elevator",
      kind: "elevator",
      standAt: lobbyTemplate.elevator.door,
    });
    expect(list.map((i) => i.id)).toContain("usage-wall");
    expect(list.map((i) => i.id)).toContain("jukebox");
    expect(list.map((i) => i.id)).not.toContain("couch");
  });
});
