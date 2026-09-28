/**
 * The local human's robot, positioned every frame from the player store
 * (no React re-render per frame: only the animation enum is subscribed).
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
import { HUMAN_PLATE_STYLE, RobotAvatar } from "../avatar/index.ts";

export function LocalAvatar() {
  const group = useRef<Group>(null);
  const animation = usePlayerStore((s) => s.animation);
  const spawned = usePlayerStore((s) => s.spawned);
  const self = useBuildingStore(
    useShallow((s) => {
      const h = selectSelf(s);
      return h
        ? { name: h.displayName, colorSet: h.avatar.colorSet, accessory: h.avatar.accessory }
        : null;
    }),
  );
  const sessionName = useSessionStore((s) => s.user?.displayName ?? null);

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
      <RobotAvatar
        look={self ? { colorSet: self.colorSet, accessory: self.accessory } : undefined}
        animation={animation}
        name={name}
        plateStyle={HUMAN_PLATE_STYLE}
        badge
      />
    </group>
  );
}
