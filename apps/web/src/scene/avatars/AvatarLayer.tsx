/**
 * Everything human in the scene: the local player and every other human
 * from the BuildingRoom presence map (SPEC §6, §9.3), anywhere in the
 * compound (#186), except inside rooms this viewer cannot see into (their
 * door stays shut and the interior private, SPEC §9.1). Pass as `avatars`.
 * Also the seats humans may take and the chat bubble feed (#49).
 */
import { Suspense } from "react";
import { useShallow } from "zustand/react/shallow";
import { type BuildingStore, useBuildingStore } from "../../state/building.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { onViewedLevel } from "../../state/level.ts";
import { type CompoundWorld, isOpenRoom, roomAt } from "../compound/world.ts";
import { useChatBubbleFeed } from "../social/Overhead.tsx";
import { SeatLayer } from "../social/SeatLayer.tsx";
import { LocalAvatar } from "./LocalAvatar.tsx";
import { RemoteAvatar } from "./RemoteAvatar.tsx";

/**
 * Session ids of the other humans to draw: everyone on the level we are
 * looking at (#268) who is not inside a room we cannot see into.
 */
export function selectRemoteSessionIds(
  store: BuildingStore,
  world: CompoundWorld | null = null,
): string[] {
  const humans = store.state?.humans;
  if (!humans) return [];
  return Object.keys(humans)
    .filter((id) => id !== store.sessionId)
    .filter((id) => {
      const h = humans[id];
      if (h && !onViewedLevel(h)) return false;
      if (!h || !world) return true;
      const room = roomAt(world, h.position.x, h.position.z);
      return !room || isOpenRoom(room);
    })
    .sort();
}

export function RemoteAvatars() {
  const world = useCompoundStore((s) => s.world);
  const ids = useBuildingStore(useShallow((s) => selectRemoteSessionIds(s, world)));
  return (
    <>
      {ids.map((id) => (
        <RemoteAvatar key={id} sessionId={id} />
      ))}
    </>
  );
}

export function AvatarLayer() {
  useChatBubbleFeed();
  return (
    <Suspense fallback={null}>
      <LocalAvatar />
      <RemoteAvatars />
      <SeatLayer />
    </Suspense>
  );
}
