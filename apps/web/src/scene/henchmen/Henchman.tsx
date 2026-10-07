/**
 * One henchman at its desk (SPEC §9.3): a henchman (#184) seated at the seat
 * pose, in its resolved skin with its provider's trim, status light by
 * status, raised hand while waiting,
 * its name and bubble words in `userData` for the probes (drawn by the layer, #256),
 * animation from status/action (one-shots settle back into the chair),
 * papers while reading, a spin when it celebrates, a dance in its chair
 * when the merge gong rings (#43, cheer.ts). Clicking it opens the
 * henchman panel (#33). Henchmen with a `HenchmanOverride` (the walk home) are drawn
 * by their override owner instead, not here.
 */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import type { HenchmanState } from "@regulus/protocol";
import type { Seat } from "@regulus/room-layout";
import { memo, useEffect, useRef } from "react";
import type { Group } from "three";
import type { SitAnchor } from "../avatar/seatedFit.ts";
import { HenchmanAvatar } from "../henchmen/HenchmanAvatar.tsx";
import { HENCHMAN_SEATED_BODY } from "../henchmen/seatedFit.ts";
import {
  calmFor,
  henchmanAnimationFor,
  henchmanLookFor,
  raisedHandFor,
} from "./henchmanAnimation.ts";
import { henchmanSkinLook } from "./henchmanLook.ts";
import { henchmanPlacement } from "./seatPlacement.ts";
import { useCheer } from "./useCheer.ts";
import { useSettledAnimation } from "./useSettledAnimation.ts";

/** One full turn at the start of a celebration, seconds. */
const SPIN_SECONDS = 0.9;

export interface HenchmanProps {
  henchman: HenchmanState;
  seat: Seat;
  /** Where to sit on this seat's chair (furniture/sitAnchor.ts). */
  anchor: SitAnchor;
  reducedMotion: boolean;
  onSelect?: (agentId: string) => void;
  /** The henchman starts its celebration (not on first sight): burst confetti over its seat. */
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

function HenchmanImpl({
  henchman,
  seat,
  anchor,
  reducedMotion,
  onSelect,
  onCelebrate,
}: HenchmanProps) {
  // Status/action → animation, held until it has settled (no flapping), one-shots once (#159).
  const animation = useSettledAnimation(calmFor(henchmanAnimationFor(henchman), reducedMotion));
  const look = henchmanLookFor(animation);
  // The merge gong rang (#43): dance in the chair for a moment, then back to the same pose.
  const cheer = useCheer(look.seated, reducedMotion);

  const shownBefore = useRef(animation);
  useEffect(() => {
    if (animation === "celebrate" && shownBefore.current !== "celebrate") onCelebrate?.(seat);
    shownBefore.current = animation;
  }, [animation, onCelebrate, seat]);
  const place = henchmanPlacement(seat, look.seated, anchor, HENCHMAN_SEATED_BODY);
  const avatar = henchmanSkinLook(henchman);

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
    onSelect(henchman.agentId);
  };

  return (
    <group
      name={`henchman-${henchman.agentId}`}
      // Read by the e2e scene probes (tests/e2e/agentProbes.ts); plain data, no behaviour.
      userData={{
        status: henchman.status,
        action: henchman.action,
        handRaised: henchman.handRaised,
        statusReason: henchman.statusReason,
        animation,
        seated: look.seated,
        seatId: henchman.seatId,
        cheering: cheer,
        skin: henchman.skin,
        name: henchman.name,
        bubbleKind: henchman.bubble.kind,
        bubbleText: henchman.bubble.text,
      }}
      position={[place.position[0], place.position[1], place.position[2]]}
      rotation-y={place.rotationY}
      onClick={select}
      onPointerOver={onSelect ? () => (document.body.style.cursor = "pointer") : undefined}
      onPointerOut={onSelect ? () => (document.body.style.cursor = "") : undefined}
    >
      <group ref={spinner}>
        <HenchmanAvatar
          skin={avatar.skin}
          trim={avatar.trim}
          animation={animation}
          seated={look.seated}
          cheer={cheer}
          status={henchman.status}
          handRaised={raisedHandFor(henchman)}
        />
        {look.papers && look.seated && <Papers />}
      </group>
    </group>
  );
}

/** Re-render only when something the henchman shows changed (not on every bubble count). */
export const Henchman = memo(
  HenchmanImpl,
  (a, b) =>
    a.seat === b.seat &&
    a.anchor === b.anchor &&
    a.reducedMotion === b.reducedMotion &&
    a.onSelect === b.onSelect &&
    a.onCelebrate === b.onCelebrate &&
    a.henchman.agentId === b.henchman.agentId &&
    a.henchman.status === b.henchman.status &&
    a.henchman.action === b.henchman.action &&
    a.henchman.handRaised === b.henchman.handRaised &&
    a.henchman.provider === b.henchman.provider &&
    a.henchman.name === b.henchman.name &&
    a.henchman.bubble.kind === b.henchman.bubble.kind &&
    a.henchman.bubble.text === b.henchman.bubble.text &&
    a.henchman.skin === b.henchman.skin,
);
