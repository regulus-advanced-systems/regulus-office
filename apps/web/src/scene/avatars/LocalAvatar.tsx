/**
 * The local human's genius (#185), positioned every frame from the player store
 * (no React re-render per frame: only the animation enum and the walk or run
 * gait, #223, are subscribed).
 * Look and name come from our own presence once the server publishes it,
 * with the session's display name as a fallback before that.
 * Seated (#49), the genius sits on the seat's sit anchor until the player
 * walks off; an emote plays as the server publishes it, a held pose plus a
 * badge with reduced motion; the speech bubble floats above the name.
 */
import { useFrame } from "@react-three/fiber";
import { isEmote } from "@regulus/protocol";
import { useMemo, useRef } from "react";
import type { Group } from "three";
import { useShallow } from "zustand/react/shallow";
import { selectSelf, useBuildingStore } from "../../state/building.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { usePlayerStore } from "../../state/player.ts";
import { useSessionStore } from "../../state/session.ts";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { GeniusAvatar } from "../geniuses/GeniusAvatar.tsx";
import { Overhead } from "../social/Overhead.tsx";
import { seatedPlacement } from "../social/seatPose.ts";
import { seatByKey } from "../social/seats.ts";

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
  const presence = useBuildingStore(
    useShallow((s) => {
      const h = selectSelf(s);
      return { userId: h?.userId ?? "", seatId: h?.seatId ?? "", animation: h?.animation ?? "" };
    }),
  );
  const selfSessionId = useBuildingStore((s) => s.sessionId);
  const sessionName = useSessionStore((s) => s.user?.displayName ?? null);
  const sessionUserId = useSessionStore((s) => s.user?.id ?? "");
  // Before our presence arrives (or right after a save), the session's look.
  const sessionLook = useSessionStore((s) => s.user?.avatar ?? null);
  const reducedMotion = useUiStore(selectReducedMotion);
  const world = useCompoundStore((s) => s.world);

  const walking = animation === "walk";
  const seat = useMemo(
    () => (presence.seatId && world ? seatByKey(world, presence.seatId) : null),
    [world, presence.seatId],
  );
  const placement = useMemo(() => (seat ? seatedPlacement(seat) : null), [seat]);
  const sitting = placement !== null && !walking;
  const emote = !walking && isEmote(presence.animation) ? presence.animation : null;

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    if (sitting && placement) {
      g.position.set(...placement.position);
      g.rotation.y = placement.rotationY;
      return;
    }
    const s = usePlayerStore.getState();
    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.heading;
  });

  if (!spawned) return null;
  const name = self?.name ?? sessionName ?? undefined;
  return (
    <group ref={group} name="local-human" userData={{ seatId: sitting ? presence.seatId : "" }}>
      <GeniusAvatar
        look={self ?? sessionLook}
        animation={emote ?? animation}
        seated={sitting}
        gait={gait}
        name={name}
        still={reducedMotion && emote !== null}
        voice={selfSessionId ?? undefined}
        overhead={
          <Overhead
            userId={presence.userId || sessionUserId}
            emote={emote}
            sessionId={selfSessionId ?? undefined}
          />
        }
      />
    </group>
  );
}
