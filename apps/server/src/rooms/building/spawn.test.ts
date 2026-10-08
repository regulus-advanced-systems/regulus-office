import { expect, test } from "bun:test";
import { EMPTY_COMPOUND } from "@regulus/protocol";
import { compoundStateOf, computeCompoundLayout, defaultCompoundSpec } from "@regulus/room-layout";
import { lobbySpawnPose, placeAtSpawn } from "./spawn.ts";

test("the spawn is the middle of the published lobby, facing its door", () => {
  const compound = compoundStateOf(computeCompoundLayout(defaultCompoundSpec(), []));
  const lobby = compound.specialRooms.find((r) => r.kind === "lobby");
  if (!lobby) throw new Error("no lobby");
  const spawn = lobbySpawnPose(compound);
  expect(spawn).toEqual({
    x: (lobby.gridX + lobby.width / 2) * compound.tileMetres,
    z: (lobby.gridY + lobby.depth / 2) * compound.tileMetres,
    // The lobby's door is in its north wall.
    heading: 0,
  });
  const human = { position: { x: 0, z: 0, heading: 1 } };
  placeAtSpawn(human, compound);
  expect(human.position).toEqual(spawn as NonNullable<typeof spawn>);
});

test("before the lair is published there is no spawn, and nobody is moved", () => {
  expect(lobbySpawnPose(EMPTY_COMPOUND)).toBeNull();
  const human = { position: { x: 3, z: 4, heading: 1 } };
  placeAtSpawn(human, EMPTY_COMPOUND);
  expect(human.position).toEqual({ x: 3, z: 4, heading: 1 });
});
