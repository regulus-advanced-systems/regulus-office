/**
 * Draws robots on their way home (#33): each send-home override from
 * `state/robotOverrides.ts` as a henchman (#184) carrying a cardboard box, placed every
 * frame from the override pose. Mount inside <OfficeCanvas> with the floor's
 * template; it also drives the walks (controller.ts).
 */
import { useFrame } from "@react-three/fiber";
import type { FloorTemplate } from "@regulus/floor-layout";
import { Suspense, useEffect, useRef } from "react";
import type { Group } from "three";
import { useShallow } from "zustand/react/shallow";
import { type RobotOverride, useRobotOverrides } from "../../../state/robotOverrides.ts";
import { HenchmanAvatar } from "../../henchmen/HenchmanAvatar.tsx";
import { robotHenchmanLook } from "../robotLook.ts";
import {
  resetSendHome,
  setSendHomeTemplate,
  tickSendHome,
  watchRemovedRobots,
} from "./controller.ts";

const BOX_COLOR = "#C8955A";
const TAPE_COLOR = "#E8D2A6";
/** Height of the box's centre, between the henchman's hands (CARRY pose). */
const CARRY_HEIGHT = 0.82;

function DepartingRobot({ override }: { override: RobotOverride }) {
  const group = useRef<Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const { x, z, heading, scale } = override.pose;
    g.position.set(x, 0, z);
    g.rotation.y = heading;
    g.scale.setScalar(Math.max(0.001, scale));
  });
  return (
    <group ref={group} name={`departing-${override.agentId}`}>
      <HenchmanAvatar
        {...robotHenchmanLook(override.robot)}
        animation={override.animation}
        status={override.robot.status}
        handRaised={false}
        carrying={override.carrying}
      />
      {override.carrying && (
        <group position={[0, CARRY_HEIGHT, -0.4]}>
          <mesh castShadow>
            <boxGeometry args={[0.42, 0.3, 0.32]} />
            <meshToonMaterial color={BOX_COLOR} />
          </mesh>
          <mesh position={[0, 0.151, 0]}>
            <boxGeometry args={[0.43, 0.005, 0.08]} />
            <meshToonMaterial color={TAPE_COLOR} />
          </mesh>
        </group>
      )}
    </group>
  );
}

export function DepartingRobots({ template }: { template: FloorTemplate }) {
  const overrides = useRobotOverrides(
    useShallow((s) => Object.values(s.overrides).filter((o) => o.kind === "send_home")),
  );

  useEffect(() => {
    setSendHomeTemplate(template);
    return () => {
      setSendHomeTemplate(null);
      resetSendHome();
    };
  }, [template]);
  useEffect(() => watchRemovedRobots(), []);
  useFrame((_, delta) => tickSendHome(Math.min(delta, 0.1)));

  return (
    <Suspense fallback={null}>
      {overrides.map((o) => (
        <DepartingRobot key={o.agentId} override={o} />
      ))}
    </Suspense>
  );
}
