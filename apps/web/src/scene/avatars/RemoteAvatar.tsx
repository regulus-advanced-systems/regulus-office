/**
 * Another human's robot, interpolated toward its last presence through a
 * small delay buffer (scene/movement/remoteInterpolation.ts). Positions are
 * pushed into the buffer straight from the building store subscription and
 * applied in useFrame, so a 20 Hz patch stream causes no React renders; only
 * the name, look and seat/doing/animation fields are subscribed. A seated
 * human sits on its seat's sit anchor like a robot does (#163).
 */
import { useFrame } from "@react-three/fiber";
import { templateById } from "@regulus/floor-layout";
import type { AvatarAnimation } from "@regulus/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { useShallow } from "zustand/react/shallow";
import { type BuildingStore, useBuildingStore } from "../../state/building.ts";
import { useFloorStore } from "../../state/floor.ts";
import { HUMAN_PLATE_STYLE, presenceAnimation, RobotAvatar } from "../avatar/index.ts";
import { sitAnchors } from "../furniture/sitAnchor.ts";
import { createPoseBuffer } from "../movement/remoteInterpolation.ts";
import { robotPlacement } from "../robots/seatPlacement.ts";

export interface RemoteAvatarProps {
  sessionId: string;
}

export function RemoteAvatar({ sessionId }: RemoteAvatarProps) {
  const group = useRef<Group>(null);
  const buffer = useMemo(() => createPoseBuffer(), []);
  const walkingRef = useRef(false);
  const [walking, setWalking] = useState(false);
  const info = useBuildingStore(
    useShallow((s) => {
      const h = s.state?.humans[sessionId];
      return h
        ? {
            name: h.displayName,
            colorSet: h.avatar.colorSet,
            accessory: h.avatar.accessory,
            seatId: h.seatId,
            doing: h.doing,
            animation: h.animation,
          }
        : null;
    }),
  );

  const templateId = useFloorStore((s) => s.state?.layoutTemplateId ?? "");
  const seatId = info?.seatId ?? "";
  const seated = useMemo(() => {
    const template = seatId ? templateById(templateId) : undefined;
    const seat = template?.seats.find((s) => s.id === seatId);
    return template && seat ? robotPlacement(seat, true, sitAnchors(template).get(seat.id)) : null;
  }, [templateId, seatId]);

  useEffect(() => {
    const push = (state: BuildingStore) => {
      const h = state.state?.humans[sessionId];
      if (h) buffer.push({ t: performance.now(), ...h.position });
    };
    push(useBuildingStore.getState());
    return useBuildingStore.subscribe(push);
  }, [sessionId, buffer]);

  useFrame(() => {
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
  });

  if (!info) return null;
  const animation: AvatarAnimation = walking ? "walk" : presenceAnimation(info);
  return (
    <group ref={group} name={`human-${sessionId}`}>
      <RobotAvatar
        look={{ colorSet: info.colorSet, accessory: info.accessory }}
        animation={animation}
        name={info.name}
        plateStyle={HUMAN_PLATE_STYLE}
        badge
      />
    </group>
  );
}
