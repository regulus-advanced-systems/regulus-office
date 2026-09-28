/**
 * Everything human in the scene: the local player and every other human on
 * our floor from the BuildingRoom presence map (SPEC §6, §9.3). Pass as
 * `avatars` to <OfficeCanvas>. Robots (agents) are a later issue.
 */
import { Suspense } from "react";
import { useShallow } from "zustand/react/shallow";
import { type BuildingStore, selectSelf, useBuildingStore } from "../../state/building.ts";
import { LocalAvatar } from "./LocalAvatar.tsx";
import { RemoteAvatar } from "./RemoteAvatar.tsx";

/** Session ids of the other humans to draw: same floor as us (all, until we know our floor). */
export function selectRemoteSessionIds(store: BuildingStore): string[] {
  const humans = store.state?.humans;
  if (!humans) return [];
  const floorId = selectSelf(store)?.floorId ?? null;
  return Object.keys(humans)
    .filter((id) => id !== store.sessionId)
    .filter((id) => floorId === null || humans[id]?.floorId === floorId)
    .sort();
}

export function RemoteAvatars() {
  const ids = useBuildingStore(useShallow(selectRemoteSessionIds));
  return (
    <>
      {ids.map((id) => (
        <RemoteAvatar key={id} sessionId={id} />
      ))}
    </>
  );
}

export function AvatarLayer() {
  return (
    <Suspense fallback={null}>
      <LocalAvatar />
      <RemoteAvatars />
    </Suspense>
  );
}
