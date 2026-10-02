/** The jukebox in a real test compound (#47): where it stands, and how loud it is around the lair. */
import { describe, expect, test } from "bun:test";
import { buildSoundField } from "../../audio/soundField.ts";
import { attenuation, JUKEBOX_FALLOFF, roomOcclusion } from "../../audio/spatial.ts";
import { compoundNavGrid } from "../compound/navigation.ts";
import { rowPlacement, testWorld } from "../compound/testing.ts";
import { roomAt, roomCentre, type WorldRoom } from "../compound/world.ts";
import { JUKEBOX_REACH, jukeboxSpot } from "./spot.ts";

const world = testWorld([{ id: "apollo", placement: rowPlacement(4), deskCount: 2 }]);
const grid = compoundNavGrid(world);
const spot = jukeboxSpot(world);
const lobby = world.rooms.find((r) => r.kind === "lobby") as WorldRoom;
const apollo = world.rooms.find((r) => r.id === "apollo") as WorldRoom;

describe("jukebox spot", () => {
  test("stands in the lobby, with a walkable spot in front of it within reach", () => {
    if (!spot) throw new Error("no jukebox");
    expect(roomAt(world, spot.x, spot.z)?.id).toBe(lobby.id);
    expect(spot.roomId).toBe(lobby.id);
    expect(grid.isWalkable(spot.stand.x, spot.stand.z)).toBe(true);
    expect(Math.hypot(spot.stand.x - spot.x, spot.stand.z - spot.z)).toBeLessThan(JUKEBOX_REACH);
  });

  test("loud in the lobby, fainter in the corridor, silent deep in a project room", () => {
    if (!spot) throw new Error("no jukebox");
    const field = buildSoundField(grid, spot, JUKEBOX_FALLOFF.maxDistance);
    const level = (p: { x: number; z: number }) =>
      attenuation(field.distanceAt(p.x, p.z), JUKEBOX_FALLOFF) *
      roomOcclusion(spot.roomId, roomAt(world, p.x, p.z)?.id ?? null);
    const atJukebox = level(spot.stand);
    const lobbyMiddle = level(roomCentre(lobby));
    const deepInApollo = level({ x: apollo.origin.x + 1.5, z: apollo.origin.z + 1.5 });
    expect(atJukebox).toBeGreaterThan(0.9);
    expect(lobbyMiddle).toBeGreaterThan(0.3);
    expect(lobbyMiddle).toBeLessThanOrEqual(atJukebox);
    expect(deepInApollo).toBeLessThan(0.05);
    // Just outside the lobby's door, in the corridor: audible but faint.
    const doorX = lobby.door.x * world.tileMetres + world.tileMetres;
    const corridor = { x: doorX, z: lobby.origin.z - 3 };
    expect(roomAt(world, corridor.x, corridor.z)).toBeNull();
    const out = level(corridor);
    expect(out).toBeGreaterThan(0.02);
    expect(out).toBeLessThan(lobbyMiddle);
  });
});
