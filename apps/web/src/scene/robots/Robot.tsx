/**
 * One robot at its desk (SPEC §9.3): RobotAvatar seated at the seat pose,
 * antenna bulb by status, provider chest light, raised hand while waiting,
 * animation from status/action (one-shots settle back into the chair),
 * papers while reading, a spin when it celebrates, a dance in its chair
 * when the merge gong rings (#43, cheer.ts). Clicking it opens the
 * robot panel (#33). Robots with a `RobotOverride` (the walk home) are drawn
 * by their override owner instead, not here.
 */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import type { Seat } from "@regulus/floor-layout";
import type { RobotState } from "@regulus/protocol";
import { memo, useEffect, useRef } from "react";
import type { Group } from "three";
import { RobotAvatar } from "../avatar/index.ts";
import type { SitAnchor } from "../avatar/seatedFit.ts";
import { calmFor, raisedHandFor, robotAnimationFor, robotLookFor } from "./robotAnimation.ts";
import { robotAvatarLook } from "./robotLook.ts";
import { robotPlacement } from "./seatPlacement.ts";
import { useCheer } from "./useCheer.ts";
import { useSettledAnimation } from "./useSettledAnimation.ts";

/** One full turn at the start of a celebration, seconds. */
const SPIN_SECONDS = 0.9;

export interface RobotProps {
  robot: RobotState;
  seat: Seat;
  /** Where to sit on this seat's chair (furniture/sitAnchor.ts). */
  anchor: SitAnchor;
  reducedMotion: boolean;
  onSelect?: (agentId: string) => void;
  /** The robot starts its celebration (not on first sight): burst confetti over its seat. */
  onCelebrate?: (seat: Seat) => void;
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

function RobotImpl({ robot, seat, anchor, reducedMotion, onSelect, onCelebrate }: RobotProps) {
  // Status/action → animation, held until it has settled (no flapping), one-shots once (#159).
  const animation = useSettledAnimation(calmFor(robotAnimationFor(robot), reducedMotion));
  const look = robotLookFor(animation);
  // The merge gong rang (#43): dance in the chair for a moment, then back to the same pose.
  const cheer = useCheer(look.seated, reducedMotion);

  const shownBefore = useRef(animation);
  useEffect(() => {
    if (animation === "celebrate" && shownBefore.current !== "celebrate") onCelebrate?.(seat);
    shownBefore.current = animation;
  }, [animation, onCelebrate, seat]);
  const place = robotPlacement(seat, look.seated, anchor);
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
      // Read by the e2e scene probes (tests/e2e/agentProbes.ts); plain data, no behaviour.
      userData={{
        status: robot.status,
        action: robot.action,
        handRaised: robot.handRaised,
        statusReason: robot.statusReason,
        animation,
        seated: look.seated,
        seatId: robot.seatId,
        cheering: cheer,
      }}
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
          cheer={cheer}
          status={robot.status}
          handRaised={raisedHandFor(robot)}
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
    a.anchor === b.anchor &&
    a.reducedMotion === b.reducedMotion &&
    a.onSelect === b.onSelect &&
    a.onCelebrate === b.onCelebrate &&
    a.robot.agentId === b.robot.agentId &&
    a.robot.status === b.robot.status &&
    a.robot.action === b.robot.action &&
    a.robot.handRaised === b.robot.handRaised &&
    a.robot.provider === b.robot.provider &&
    a.robot.ownerUserId === b.robot.ownerUserId,
);
