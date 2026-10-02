/**
 * Another human's genius (#185), interpolated toward its last presence through a
 * small delay buffer (scene/movement/remoteInterpolation.ts). Positions are
 * pushed into the buffer straight from the building store subscription and
 * applied in useFrame, so a 20 Hz patch stream causes no React renders; only
 * the name, look and seat/doing/animation fields are subscribed. A seated
 * human sits on its seat's sit anchor like a henchman does (#163; seats of
 * any room, #49). Whether it walks or runs (#223) is read from its
 * interpolated speed (gait.ts), so running needs nothing on the wire. Its
 * speech bubble and, with reduced motion, emote badge float above the name.
 */
import { useFrame } from "@react-three/fiber";
import { type AvatarAnimation, isEmote } from "@regulus/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { useShallow } from "zustand/react/shallow";
import { type BuildingStore, useBuildingStore } from "../../state/building.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { presenceAnimation } from "../avatar/index.ts";
import { GeniusAvatar } from "../geniuses/GeniusAvatar.tsx";
import { createGaitTracker, type Gait } from "../movement/gait.ts";
import { createPoseBuffer } from "../movement/remoteInterpolation.ts";
import { Overhead } from "../social/Overhead.tsx";
import { seatedPlacement } from "../social/seatPose.ts";
import { seatByKey } from "../social/seats.ts";

export interface RemoteAvatarProps {
  sessionId: string;
}

export function RemoteAvatar({ sessionId }: RemoteAvatarProps) {
  const group = useRef<Group>(null);
  const buffer = useMemo(() => createPoseBuffer(), []);
  const walkingRef = useRef(false);
  const [walking, setWalking] = useState(false);
  const tracker = useMemo(() => createGaitTracker(), []);
  const [gait, setGait] = useState<Gait>("walk");
  const info = useBuildingStore(
    useShallow((s) => {
      const h = s.state?.humans[sessionId];
      return h
        ? {
            userId: h.userId,
            name: h.displayName,
            archetype: h.avatar.archetype,
            outfit: h.avatar.outfit,
            trim: h.avatar.trim,
            skin: h.avatar.skin,
            hair: h.avatar.hair,
            accessory: h.avatar.accessory,
            seatId: h.seatId,
            doing: h.doing,
            animation: h.animation,
          }
        : null;
    }),
  );

  const world = useCompoundStore((s) => s.world);
  const seatId = info?.seatId ?? "";
  const reducedMotion = useUiStore(selectReducedMotion);
  // A seat key names its room (#49): any chair or couch of a room this viewer sees into.
  const seated = useMemo(() => {
    const seat = seatId && world ? seatByKey(world, seatId) : null;
    return seat ? seatedPlacement(seat) : null;
  }, [world, seatId]);

  useEffect(() => {
    const push = (state: BuildingStore) => {
      const h = state.state?.humans[sessionId];
      if (h) buffer.push({ t: performance.now(), ...h.position });
    };
    push(useBuildingStore.getState());
    return useBuildingStore.subscribe(push);
  }, [sessionId, buffer]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const p = buffer.sampleAt(performance.now());
    if (!p) return;
    if (seated && !p.moving) {
      g.position.set(...seated.position);
      g.rotation.y = seated.rotationY;
    } else {
      g.position.set(p.x, 0, p.z);
      g.rotation.y = p.heading;
    }
    if (p.moving !== walkingRef.current) {
      walkingRef.current = p.moving;
      setWalking(p.moving);
    }
    const before = tracker.gait;
    if (p.moving) tracker.update(p.speed, delta);
    else tracker.reset();
    if (tracker.gait !== before) setGait(tracker.gait);
  });

  if (!info) return null;
  const animation: AvatarAnimation = walking ? "walk" : presenceAnimation(info);
  const emote = isEmote(animation) ? animation : null;
  const sitting = seated !== null && !walking;
  return (
    <group ref={group} name={`human-${sessionId}`} userData={{ seatId: sitting ? seatId : "" }}>
      <GeniusAvatar
        look={info}
        animation={animation}
        seated={sitting}
        gait={gait}
        name={info.name}
        still={reducedMotion && emote !== null}
        voice={sessionId}
        overhead={<Overhead userId={info.userId} emote={emote} sessionId={sessionId} />}
      />
    </group>
  );
}
