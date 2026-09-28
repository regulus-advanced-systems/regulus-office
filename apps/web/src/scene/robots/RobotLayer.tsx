/**
 * Robots on the floor we are on (SPEC §9.3, §9.4): one <Robot> per
 * `RobotState` from the FloorRoom at its desk seat, the GDT floor name
 * decals, work bubbles flying to the HUD counters, confetti when a robot
 * finishes and a soft ding when a hand goes up. Also the free-desk
 * interaction: `E` near a free desk (or a click on it) opens the spawn
 * dialog. A click on a robot or its occupied desk opens the robot panel
 * (#33); `E` at an occupied desk and laptop clicks open the terminal
 * (scene/laptops).
 *
 * Robots with a `RobotOverride` (#33's walk home) are skipped: their
 * override owner draws them (scene/robots/sendHome).
 * Bubbles and confetti are not mounted with reduced motion (SPEC §11).
 */
import type { ThreeEvent } from "@react-three/fiber";
import type { FloorTemplate, Seat } from "@regulus/floor-layout";
import { hasFloorAccess, type RobotState } from "@regulus/protocol";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createDingGate, playDing } from "../../audio/ding.ts";
import { useFloorStore } from "../../state/floor.ts";
import { useFloorsStore } from "../../state/floors.ts";
import { usePlayerStore } from "../../state/player.ts";
import { useRobotOverrides } from "../../state/robotOverrides.ts";
import { useSpawnStore } from "../../state/spawn.ts";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { openAgentPanel } from "../../ui/agent/agentStore.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import { type BubbleSource, WorkBubbles } from "./bubbles/WorkBubbles.tsx";
import { Confetti, createConfettiBus } from "./Confetti.tsx";
import { freeDeskAt } from "./deskInteraction.ts";
import { NameDecal } from "./NameDecal.tsx";
import { Robot } from "./Robot.tsx";
import { celebrates, raisesHand } from "./robotAnimation.ts";
import { facing, laptopOrigin } from "./seatPlacement.ts";

const EMPTY: Readonly<Record<string, RobotState>> = {};

export interface RobotLayerProps {
  template: FloorTemplate;
  /** Robots to draw; defaults to the FloorRoom's (the dev harness passes fakes). */
  robots?: Readonly<Record<string, RobotState>>;
}

/** Open the spawn dialog at a free desk, if this human may spawn on the floor. */
export function useOpenSpawn() {
  const openSpawn = useSpawnStore((s) => s.openSpawn);
  const toast = useUiStore((s) => s.toast);
  const floorId = useFloorStore((s) => s.floorId);
  const access = useFloorsStore((s) => s.floors?.find((f) => f.floorId === floorId)?.access);
  return useCallback(
    (seatId: string) => {
      if (access && !hasFloorAccess(access, "spawn")) {
        toast({ kind: "info", message: "You can watch on this floor but not spawn robots." });
        return;
      }
      openSpawn(seatId);
    },
    [openSpawn, toast, access],
  );
}

/**
 * Invisible click targets over each desk's chair (not the desk top, so the
 * laptop keeps its own click): a free desk opens the spawn dialog (and walks
 * the player over), an occupied one the robot's panel.
 */
function DeskHotspots({
  seats,
  agentAt,
  onSpawn,
}: {
  seats: readonly Seat[];
  agentAt: (seatId: string) => string | undefined;
  onSpawn: (seatId: string) => void;
}) {
  return (
    <group name="desk-hotspots">
      {seats.map((seat) => {
        const f = facing(seat.pose.heading);
        const click = (event: ThreeEvent<MouseEvent>) => {
          if (event.nativeEvent.button !== 0) return;
          event.stopPropagation();
          const agentId = agentAt(seat.id);
          if (agentId) {
            openAgentPanel(agentId);
            return;
          }
          // Walk over to the desk while the dialog is up.
          usePlayerStore.getState().setTarget(seat.pose.x, seat.pose.z);
          onSpawn(seat.id);
        };
        return (
          <mesh
            key={seat.id}
            name={`desk-hotspot-${seat.id}`}
            position={[seat.pose.x - f.x * 0.05, 0.6, seat.pose.z - f.z * 0.05]}
            rotation-y={seat.pose.heading}
            onClick={click}
            onPointerOver={() => (document.body.style.cursor = "pointer")}
            onPointerOut={() => (document.body.style.cursor = "")}
          >
            <boxGeometry args={[1, 1.2, 0.8]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}

export function RobotLayer({ template, robots: given }: RobotLayerProps) {
  const live = useFloorStore((s) => s.state?.robots ?? EMPTY);
  const robots = given ?? live;
  const overrides = useRobotOverrides((s) => s.overrides);
  const reducedMotion = useUiStore(selectReducedMotion);
  const volume = useUiStore((s) => s.settings.volume);
  const openSpawn = useOpenSpawn();

  const deskSeats = useMemo(() => template.seats.filter((s) => s.kind === "desk"), [template]);
  const seatsById = useMemo(() => new Map(template.seats.map((s) => [s.id, s])), [template]);
  const occupiedKey = Object.values(robots)
    .map((r) => `${r.seatId}=${r.agentId}`)
    .sort()
    .join("|");
  const bySeat = useMemo(
    () =>
      new Map(
        occupiedKey ? occupiedKey.split("|").map((kv) => kv.split("=") as [string, string]) : [],
      ),
    [occupiedKey],
  );
  const occupied = useMemo(() => new Set(bySeat.keys()), [bySeat]);
  const agentAt = useCallback((seatId: string) => bySeat.get(seatId), [bySeat]);

  // `E` at a free desk.
  useHotkeyEvents(
    useCallback(
      (detail: { id: string }) => {
        if (detail.id !== "interact") return;
        const player = usePlayerStore.getState();
        if (!player.spawned) return;
        const seat = freeDeskAt(deskSeats, player, (id) => occupied.has(id));
        if (seat) openSpawn(seat.id);
      },
      [deskSeats, occupied, openSpawn],
    ),
  );

  // Transitions: confetti on finishing, a ding when a hand goes up.
  const confetti = useMemo(() => createConfettiBus(), []);
  const ding = useMemo(() => createDingGate(), []);
  const prev = useRef<Readonly<Record<string, RobotState>>>({});
  useEffect(() => {
    const before = prev.current;
    prev.current = robots;
    let rang = false;
    for (const r of Object.values(robots)) {
      const old = before[r.agentId];
      const seat = seatsById.get(r.seatId);
      if (!reducedMotion && seat && celebrates(old, r)) {
        confetti.pending.push({ x: seat.pose.x, y: 1.7, z: seat.pose.z });
      }
      if (!rang && raisesHand(old, r)) {
        rang = true;
        if (ding({ now: performance.now(), volume, reducedMotion })) playDing(volume);
      }
    }
  }, [robots, seatsById, reducedMotion, volume, confetti, ding]);

  const visible = useMemo(
    () => Object.values(robots).filter((r) => !(r.agentId in overrides) && seatsById.has(r.seatId)),
    [robots, overrides, seatsById],
  );
  const sources = useMemo<BubbleSource[]>(
    () =>
      visible.map((r) => ({
        agentId: r.agentId,
        bubbleEmits: r.bubbleEmits,
        origin: laptopOrigin(template, seatsById.get(r.seatId) as Seat),
      })),
    [visible, seatsById, template],
  );

  return (
    <group name="robots">
      {visible.map((r) => {
        const seat = seatsById.get(r.seatId) as Seat;
        return (
          <group key={r.agentId}>
            <Robot robot={r} seat={seat} reducedMotion={reducedMotion} onSelect={openAgentPanel} />
            <NameDecal seat={seat} ownerName={r.ownerName} model={r.model} />
          </group>
        );
      })}
      <DeskHotspots seats={deskSeats} agentAt={agentAt} onSpawn={openSpawn} />
      {!reducedMotion && <WorkBubbles sources={sources} />}
      {!reducedMotion && <Confetti bus={confetti} />}
    </group>
  );
}
