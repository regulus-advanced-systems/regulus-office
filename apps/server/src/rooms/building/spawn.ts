/**
 * Where a person is when they join (#252, #60): the middle of the lobby,
 * facing its door, which is where every client puts its own player
 * (`lobbySpawn` in apps/web/src/scene/compound/navigation.ts). The room knows
 * a person's position only from their `move` commands, and one who has not
 * moved yet (they just signed in and stand still, or their tab has not drawn
 * a frame) has sent none. Without this they would be at 0,0 for everyone
 * else, and their personal agent would walk off to that corner instead of
 * standing beside them.
 */
import { COMPOUND_TILE_METRES } from "@regulus/protocol";
import { HEADING, type Pose } from "@regulus/room-layout";

interface CompoundLike {
  tileMetres: number;
  specialRooms: Iterable<{
    kind: string;
    gridX: number;
    gridY: number;
    width: number;
    depth: number;
    doorSide: string;
  }>;
}

/** The lobby spawn pose, compound metres; null while the compound is not published. */
export function lobbySpawnPose(compound: CompoundLike): Pose | null {
  const m = compound.tileMetres || COMPOUND_TILE_METRES;
  for (const room of compound.specialRooms) {
    if (room.kind !== "lobby" || room.width <= 0) continue;
    const side = room.doorSide as keyof typeof HEADING;
    return {
      x: (room.gridX + room.width / 2) * m,
      z: (room.gridY + room.depth / 2) * m,
      heading: HEADING[side] ?? 0,
    };
  }
  return null;
}

/** Put a person who has sent no position yet at the lobby spawn. */
export function placeAtSpawn(
  human: { position: { x: number; z: number; heading: number } },
  compound: CompoundLike,
): void {
  const spawn = lobbySpawnPose(compound);
  if (!spawn) return;
  human.position.x = spawn.x;
  human.position.z = spawn.z;
  human.position.heading = spawn.heading;
}
