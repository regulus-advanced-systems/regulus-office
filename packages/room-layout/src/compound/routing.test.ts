import { describe, expect, test } from "bun:test";
import { computeCompoundLayout } from "./layout.ts";
import { routeCorridors } from "./routing.ts";
import { defaultCompoundSpec } from "./special.ts";
import { checkPlacement } from "./validate.ts";

const spec = defaultCompoundSpec();

describe("corridor routing", () => {
  test("a room on the main corridor needs no extra corridor", () => {
    const placement = { gridX: 4, gridY: 44, width: 10, depth: 10, doorSide: "south" as const };
    const bare = computeCompoundLayout(spec, []);
    const layout = computeCompoundLayout(spec, [{ id: "a", placement }]);
    expect(layout.network.routes.get("a")).toHaveLength(1);
    expect([...layout.network.tiles]).toEqual([...bare.network.tiles]);
  });

  test("a room facing away routes around itself, straight where it can", () => {
    const placement = { gridX: 26, gridY: 30, width: 10, depth: 10, doorSide: "north" as const };
    const layout = computeCompoundLayout(spec, [{ id: "a", placement }]);
    const route = layout.network.routes.get("a") ?? [];
    expect(route[0]).toEqual({ x: 30, y: 28 });
    expect(route.at(-1)?.y).toBe(54);
    let turns = 0;
    for (let i = 2; i < route.length; i++) {
      const [a, b, c] = [route[i - 2], route[i - 1], route[i]];
      if (a && b && c && (b.x - a.x !== c.x - b.x || b.y - a.y !== c.y - b.y)) turns++;
    }
    // Out of the door it turns once onto the side (not counted: the route starts there),
    // then once more to run south to the main corridor.
    expect(turns).toBe(1);
  });

  test("a second room reuses the first room's corridor", () => {
    const a = {
      id: "a",
      placement: { gridX: 26, gridY: 30, width: 10, depth: 10, doorSide: "east" as const },
    };
    const b = {
      id: "b",
      placement: { gridX: 40, gridY: 30, width: 10, depth: 10, doorSide: "west" as const },
    };
    // The doors face each other across a 4-tile gap: a's corridor runs down it, b joins it.
    expect(checkPlacement(spec, [a], "b", b.placement).ok).toBe(true);
    const layout = computeCompoundLayout(spec, [a, b]);
    const route = layout.network.routes.get("b") ?? [];
    expect(route).toEqual([
      { x: 38, y: 34 },
      { x: 37, y: 34 },
      { x: 36, y: 34 },
    ]);
  });

  test("a door walled in by rooms is reported unreachable", () => {
    const rooms = [
      { id: "pocket", rect: { x: 10, y: 10, w: 4, d: 4 }, doorSide: "south" as const },
      { id: "wall-s", rect: { x: 0, y: 15, w: 30, d: 4 }, doorSide: "south" as const },
      { id: "wall-w", rect: { x: 0, y: 0, w: 4, d: 15 }, doorSide: "west" as const },
      { id: "wall-e", rect: { x: 20, y: 0, w: 4, d: 15 }, doorSide: "east" as const },
    ];
    const net = routeCorridors(40, 40, rooms, { x: 0, y: 30, w: 40, d: 2 }, { x: 20, y: 30 });
    expect(net.unreachable).toContain("pocket");
    expect(net.unreachable).not.toContain("wall-s");
  });
});
