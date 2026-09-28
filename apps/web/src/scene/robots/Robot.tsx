/**
 * One robot at its desk (SPEC §9.3): RobotAvatar seated at the seat pose,
 * antenna bulb by status, provider chest light, raised hand while waiting,
 * animation from status/action (one-shots settle back into the chair),
 * papers while reading, a spin when it celebrates. Clicking it opens the
 * robot panel (#33). Robots with a `RobotOverride` (the walk home) are drawn
 * by their override owner instead, not here.
 */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import type { Seat } from "@regulus/floor-layout";
import type { RobotState } from "@regulus/protocol";
import { memo, useEffect, useRef, useState } from "react";
import type { Group } from "three";
import { RobotAvatar } from "../avatar/index.ts";
import { ONE_SHOT_MS, robotAnimationFor, robotLookFor, settleOneShot } from "./robotAnimation.ts";
import { robotAvatarLook } from "./robotLook.ts";
import { robotPlacement } from "./seatPlacement.ts";

/** One full turn at the start of a celebration, seconds. */
const SPIN_SECONDS = 0.9;

export interface RobotProps {
  robot: RobotState;
  seat: Seat;
  reducedMotion: boolean;
  onSelect?: (agentId: string) => void;
}

function Papers() {
  return (
    <group position={[0, 0.78, -0.3]} rotation-x={0.9}>
      <mesh position={[-0.05, 0, 0]} rotation-z={0.12}>
        <boxGeometry args={[0.2, 0.26, 0.006]} />
        <meshBasicMaterial color="#FAFAF5" />
      </mesh>
      <mesh position={[0.06, 0.01, 0.006]} rotation-z={-0.08}>
        <boxGeometry args={[0.2, 0.26, 0.006]} />
        <meshBasicMaterial color="#F1EEDF" />
      </mesh>
    </group>
  );
}

function RobotImpl({ robot, seat, reducedMotion, onSelect }: RobotProps) {
  const derived = robotAnimationFor(robot);
  // When the current animation started, so one-shots can settle.
  const [since, setSince] = useState(() => ({ animation: derived, at: performance.now() }));
  if (since.animation !== derived) setSince({ animation: derived, at: performance.now() });
  const [, tick] = useState(0);
  useEffect(() => {
    const limit = ONE_SHOT_MS[since.animation];
    if (limit === undefined) return;
    const left = since.at + limit - performance.now();
    const timer = setTimeout(() => tick((n) => n + 1), Math.max(0, left) + 20);
    return () => clearTimeout(timer);
  }, [since]);

  const animation = settleOneShot(derived, since.at, performance.now());
  const look = robotLookFor(animation);
  const place = robotPlacement(seat, look.seated);
  const avatar = robotAvatarLook(robot);

  const spinner = useRef<Group>(null);
  const spinStart = useRef<number | null>(null);
  useFrame(() => {
    const g = spinner.current;
    if (!g) return;
    if (!look.spin || reducedMotion) {
      spinStart.current = null;
      g.rotation.y = 0;
      return;
    }
    const now = performance.now();
    spinStart.current ??= now;
    const k = Math.min(1, (now - spinStart.current) / 1000 / SPIN_SECONDS);
    g.rotation.y = (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2) * Math.PI * 2;
  });

  const select = (event: ThreeEvent<MouseEvent>) => {
    if (!onSelect || event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    onSelect(robot.agentId);
  };

  return (
    <group
      name={`robot-${robot.agentId}`}
      position={[place.position[0], place.position[1], place.position[2]]}
      rotation-y={place.rotationY}
      onClick={select}
      onPointerOver={onSelect ? () => (document.body.style.cursor = "pointer") : undefined}
      onPointerOut={onSelect ? () => (document.body.style.cursor = "") : undefined}
    >
      <group ref={spinner}>
        <RobotAvatar
          look={avatar.look}
          animation={animation}
          seated={look.seated}
          status={robot.status}
          handRaised={robot.handRaised}
          chestLight={avatar.chestLight}
        />
        {look.papers && look.seated && <Papers />}
      </group>
    </group>
  );
}

/** Re-render only when something the robot shows changed (not on every bubble count). */
export const Robot = memo(
  RobotImpl,
  (a, b) =>
    a.seat === b.seat &&
    a.reducedMotion === b.reducedMotion &&
    a.onSelect === b.onSelect &&
    a.robot.agentId === b.robot.agentId &&
    a.robot.status === b.robot.status &&
    a.robot.action === b.robot.action &&
    a.robot.handRaised === b.robot.handRaised &&
    a.robot.provider === b.robot.provider &&
    a.robot.ownerUserId === b.robot.ownerUserId,
);
