/**
 * The local human's genius (#185), positioned every frame from the player store
 * (no React re-render per frame: only the animation enum and the walk or run
 * gait, #223, are subscribed).
 * Look and name come from our own presence once the server publishes it,
 * with the session's display name as a fallback before that.
 */
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { useShallow } from "zustand/react/shallow";
import { selectSelf, useBuildingStore } from "../../state/building.ts";
import { usePlayerStore } from "../../state/player.ts";
import { useSessionStore } from "../../state/session.ts";
import { GeniusAvatar } from "../geniuses/GeniusAvatar.tsx";

export function LocalAvatar() {
  const group = useRef<Group>(null);
  const animation = usePlayerStore((s) => s.animation);
  const gait = usePlayerStore((s) => s.gait);
  const spawned = usePlayerStore((s) => s.spawned);
  const self = useBuildingStore(
    useShallow((s) => {
      const h = selectSelf(s);
      return h ? { name: h.displayName, ...h.avatar } : null;
    }),
  );
  const sessionName = useSessionStore((s) => s.user?.displayName ?? null);
  // Before our presence arrives (or right after a save), the session's look.
  const sessionLook = useSessionStore((s) => s.user?.avatar ?? null);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const s = usePlayerStore.getState();
    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.heading;
  });

  if (!spawned) return null;
  const name = self?.name ?? sessionName ?? undefined;
  return (
    <group ref={group} name="local-human">
      <GeniusAvatar look={self ?? sessionLook} animation={animation} gait={gait} name={name} />
    </group>
  );
}
