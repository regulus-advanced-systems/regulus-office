import { describe, expect, test } from "bun:test";
import { triangleCount } from "../../lair/geometry/builder.ts";
import { rowPlacement, testWorld } from "../testing.ts";
import { boatGeometry } from "./boat.ts";
import { outsideLayout, SEA_LEVEL, shoreZ } from "./layout.ts";
import { openTiles } from "./Mountain.tsx";
import { MOUNTAIN_RIM, mountainGeometry } from "./mountain.ts";
import { leafGeometry, portalGeometry } from "./portal.ts";
import { beachProps } from "./props.ts";
import { sandGeometry, sandHeight, seaColor, seaDepth, seaGeometry } from "./water.ts";

const world = testWorld(
  [
    { id: "apollo", placement: rowPlacement(4), deskCount: 2 },
    { id: "zeus", placement: rowPlacement(28, 10, 8), deskCount: 3 },
  ],
  undefined,
  64,
);
const layout = outsideLayout(world);
if (!layout) throw new Error("no outside");
const m = world.tileMetres;

function finite(geo: { getAttribute(n: string): { array: ArrayLike<number> } }) {
  return Array.from(geo.getAttribute("position").array).every(Number.isFinite);
}

describe("the mountain round the compound (#188, #190)", () => {
  const geo = mountainGeometry({
    width: world.width,
    depth: world.depth,
    tileMetres: m,
    open: openTiles(world),
    layout,
  });
  const pos = geo.getAttribute("position");

  test("one cheap mesh: vertex-coloured, finite, a few tens of thousands of triangles", () => {
    expect(geo.getAttribute("color")).toBeDefined();
    expect(finite(geo)).toBe(true);
    expect(triangleCount(geo)).toBeLessThan(40_000);
  });

  test("no rock over a room or a corridor; rock at a room's edge sits just above the walls", () => {
    const inside = (x: number, z: number) =>
      openTiles(world).some(
        (r) =>
          x > r.x * m + 1e-3 &&
          x < (r.x + r.w) * m - 1e-3 &&
          z > r.y * m + 1e-3 &&
          z < (r.y + r.d) * m - 1e-3,
      );
    let rim = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      expect(inside(x, z)).toBe(false);
      if (Math.abs(y - MOUNTAIN_RIM) < 1e-4) rim += 1;
      // Inside the compound nothing is lower than the walls, except the cliffs to the sea.
      if (x > 0 && x < world.width * m && z > 0 && z < world.depth * m)
        expect(y).toBeGreaterThanOrEqual(MOUNTAIN_RIM - 1e-4);
    }
    expect(rim).toBeGreaterThan(100);
  });

  test("rock rises beyond the compound (the mountain's shoulders) and drops into the sea in the south", () => {
    let north = Number.NEGATIVE_INFINITY;
    let south = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) < -20) north = Math.max(north, pos.getY(i));
      if (pos.getZ(i) > layout.edgeZ + 20) south = Math.min(south, pos.getY(i));
    }
    expect(north).toBeGreaterThan(MOUNTAIN_RIM + 8);
    expect(south).toBeLessThan(SEA_LEVEL);
  });
});

describe("beach and sea", () => {
  test("the sand is flat (walkable at y = 0) to just before the waterline, then shelves under the sea", () => {
    const x = layout.door.centre;
    expect(sandHeight(layout, x, layout.edgeZ + 2)).toBe(0);
    expect(sandHeight(layout, x, shoreZ(layout, x))).toBeCloseTo(SEA_LEVEL, 6);
    expect(sandHeight(layout, x, shoreZ(layout, x) + 3)).toBeLessThan(SEA_LEVEL);
    expect(finite(sandGeometry(layout))).toBe(true);
  });

  test("the sea: turquoise in the shallows, deep blue far out, a depth per vertex for the shader", () => {
    const shallow = seaColor(0);
    const deep = seaColor(60);
    expect(shallow.g).toBeGreaterThan(shallow.b * 0.6);
    expect(deep.b).toBeGreaterThan(deep.g);
    expect(
      seaDepth(layout, layout.door.centre, shoreZ(layout, layout.door.centre) + 5),
    ).toBeCloseTo(5, 6);
    const sea = seaGeometry(layout);
    expect(sea.getAttribute("depth").count).toBe(sea.getAttribute("position").count);
    const small = seaGeometry(layout, { halfWidth: 70, reach: 56 });
    expect(small.getAttribute("position").count).toBeLessThan(
      sea.getAttribute("position").count / 3,
    );
  });
});

describe("props, boat, portal and door leaf", () => {
  test("all procedural, finite, vertex-coloured and low-poly", () => {
    const props = beachProps(layout);
    const portal = portalGeometry(layout);
    const leaf = leafGeometry();
    const parts = [
      props.body,
      props.glow,
      portal.body,
      portal.glow,
      leaf.body,
      leaf.glow,
      boatGeometry(),
    ];
    for (const g of parts) {
      if (!g) throw new Error("missing layer");
      expect(finite(g)).toBe(true);
      expect(g.getAttribute("color")).toBeDefined();
    }
    expect(triangleCount(props.body)).toBeLessThan(25_000);
    expect(triangleCount(portal.body)).toBeLessThan(12_000);
    expect(triangleCount(leaf.body)).toBeLessThan(2_000);
    expect(triangleCount(boatGeometry())).toBeLessThan(2_000);
  });
});
