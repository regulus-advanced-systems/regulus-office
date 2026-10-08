/** The reception desk on the real compound nav grid (#60). */
import { describe, expect, test } from "bun:test";
import { findPath } from "@regulus/room-layout";
import { compoundNavGrid, lobbySpawn } from "../compound/navigation.ts";
import { specialDressing } from "../compound/special.ts";
import { rowPlacement, testWorld } from "../compound/testing.ts";
import { lobbyOf, type WorldRoom } from "../compound/world.ts";
import { atDesk, RECEPTION_REACH, receptionSpot } from "./spot.ts";

const world = testWorld([{ id: "apollo", placement: rowPlacement(4) }]);
const grid = compoundNavGrid(world);
const lobby = lobbyOf(world) as WorldRoom;
const spot = receptionSpot(world);
if (!spot) throw new Error("no reception");

const reachable = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  findPath(grid, grid.worldToCell(a.x, a.z), grid.worldToCell(b.x, b.z)) !== null;

describe("the reception desk", () => {
  test("is the counter the lobby is dressed with, with its chair behind it", () => {
    const dressing = specialDressing("lobby", lobby.size.w, lobby.size.d);
    const desk = dressing.furniture.find((f) => f.model === "reception_desk");
    expect(desk?.rect.x).toBeCloseTo(spot.desk.x - lobby.origin.x, 6);
    expect(desk?.rect.z).toBeCloseTo(spot.desk.z - lobby.origin.z, 6);
    expect(desk?.rect.w).toBe(spot.desk.w);
    expect(desk?.rect.d).toBe(spot.desk.d);
    expect(dressing.furniture.filter((f) => f.model === "reception_desk")).toHaveLength(1);
    expect(dressing.extras.some((e) => e.piece === "swivel_chair")).toBe(true);
  });

  test("the counter blocks; a visitor's spot and the PM's post are open floor on either side", () => {
    const middle = { x: spot.desk.x + spot.desk.w / 2, z: spot.desk.z + spot.desk.d / 2 };
    expect(grid.isWalkable(middle.x, middle.z)).toBe(false);
    expect(grid.isWalkable(spot.stand.x, spot.stand.z)).toBe(true);
    expect(grid.isWalkable(spot.post.x, spot.post.z)).toBe(true);
    // The counter is between them.
    expect(spot.post.x).toBeLessThan(spot.desk.x);
    expect(spot.stand.x).toBeGreaterThan(spot.desk.x + spot.desk.w);
    expect(spot.post.z).toBeGreaterThan(spot.desk.z);
    expect(spot.post.z).toBeLessThan(spot.desk.z + spot.desk.d);
  });

  test("the PM can walk from its post out into the lair and back, and a visitor to the desk", () => {
    const spawn = lobbySpawn(world);
    expect(reachable(spawn, spot.stand)).toBe(true);
    expect(reachable(spot.post, spawn)).toBe(true);
    expect(reachable(spot.post, spot.stand)).toBe(true);
  });

  test("E reaches from in front of the counter, not from across the lobby", () => {
    expect(atDesk(spot, spot.stand)).toBe(true);
    expect(atDesk(spot, { x: spot.stand.x + RECEPTION_REACH - 0.1, z: spot.stand.z })).toBe(true);
    expect(atDesk(spot, { x: spot.stand.x + RECEPTION_REACH + 0.1, z: spot.stand.z })).toBe(false);
    expect(atDesk(spot, lobbySpawn(world))).toBe(false);
    // Standing at the counter is talking to the PM across it, a couple of metres away.
    const gap = Math.hypot(spot.stand.x - spot.post.x, spot.stand.z - spot.post.z);
    expect(gap).toBeGreaterThan(1.5);
    expect(gap).toBeLessThan(4);
  });
});
