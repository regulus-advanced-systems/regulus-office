/**
 * Build mode's part of the compound scene (#187): the ghost and its cursor
 * while placing or moving a room, the crews and progress plates of rooms
 * under construction, and the room transitions (raise, reveal, grow, move,
 * demolish). Mounted inside <LairKit> by CompoundCanvas.
 */
import { useBuildModeStore } from "../../../ui/build-mode/store.ts";
import type { CompoundWorld } from "../world.ts";
import { BuildSites } from "./BuildSites.tsx";
import { Ghost, GhostPointer } from "./Ghost.tsx";
import { RoomTransitions, type useRoomTransitions } from "./RoomTransitions.tsx";

export function BuildLayer({
  world,
  visible,
  playing,
}: {
  world: CompoundWorld;
  visible: ReadonlySet<string>;
  playing: ReturnType<typeof useRoomTransitions>["playing"];
}) {
  const placing = useBuildModeStore((s) => s.intent !== null);
  return (
    <group name="build-layer">
      {placing && (
        <>
          <GhostPointer world={world} />
          <Ghost world={world} />
        </>
      )}
      <BuildSites world={world} visible={visible} />
      <RoomTransitions playing={playing} />
    </group>
  );
}
