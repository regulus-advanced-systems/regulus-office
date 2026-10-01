/**
 * Henchmen in the operation we are in (SPEC §9.3, §9.4): one <Henchman> per
 * `HenchmanState` from the OperationRoom at its desk seat, the GDT floor name
 * decals, work bubbles flying to the HUD counters, confetti when a henchman
 * starts its celebration and a soft ding when a hand goes up. Also the free-desk
 * interaction: `E` near a free desk (or a click on it) opens the spawn
 * dialog. A click on a henchman or its occupied desk opens the henchman panel
 * (#33); `E` at an occupied desk and laptop clicks open the terminal
 * (scene/laptops).
 *
 * Henchmen with a `HenchmanOverride` (#33's walk home) are skipped: their
 * override owner draws them (scene/henchmen/sendHome).
 * When the merge gong rings (#43) confetti bursts over every henchman while
 * they cheer in their chairs (Henchman, cheer.ts).
 * Bubbles and confetti are not mounted with reduced motion (SPEC §11).
 */
import type { ThreeEvent } from "@react-three/fiber";
import { type HenchmanState, hasOperationAccess } from "@regulus/protocol";
import type { RoomTemplate, Seat } from "@regulus/room-layout";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createDingGate, playDing } from "../../audio/ding.ts";
import { useHenchmanOverrides } from "../../state/henchmanOverrides.ts";
import { useOperationStore } from "../../state/operation.ts";
import { useOperationsStore } from "../../state/operations.ts";
import { useSpawnStore } from "../../state/spawn.ts";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { openAgentPanel } from "../../ui/agent/agentStore.ts";
import { carriedPrefill, dropCard, useMyCarried } from "../../ui/boards/carry.ts";
import type { HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import { useVisibleStore } from "../compound/visibility.ts";
import { FALLBACK_ANCHOR, type SitAnchor, sitAnchors } from "../furniture/sitAnchor.ts";
import { useGongStore } from "../gong/gongStore.ts";
import { HENCHMAN_CONFETTI } from "../gong/timing.ts";
import { playerInRoom, scopedName, useRoomScope, walkInRoom } from "../roomScope.ts";
import { type BubbleSource, WorkBubbles } from "./bubbles/WorkBubbles.tsx";
import { Confetti, createConfettiBus } from "./Confetti.tsx";
import { freeDeskAt } from "./deskInteraction.ts";
import { Henchman } from "./Henchman.tsx";
import { raisesHand } from "./henchmanAnimation.ts";
import { NameDecal } from "./NameDecal.tsx";
import { facing, laptopOrigin } from "./seatPlacement.ts";

const EMPTY: Readonly<Record<string, HenchmanState>> = {};

export interface HenchmanLayerProps {
  template: RoomTemplate;
  /** Henchmen to draw; defaults to the OperationRoom's (the dev harness passes fakes). */
  henchmen?: Readonly<Record<string, HenchmanState>>;
  /** Sit anchors per seat; defaults to the template's furniture models (the lair's chairs in the compound). */
  anchorsFor?: (template: RoomTemplate) => ReadonlyMap<string, SitAnchor>;
}

/** Open the spawn dialog at a free desk (prefilled from a carried card), if this human may spawn here. */
export function useOpenSpawn() {
  const openSpawn = useSpawnStore((s) => s.openSpawn);
  const toast = useUiStore((s) => s.toast);
  const operationId = useOperationStore((s) => s.operationId);
  const access = useOperationsStore(
    (s) => s.operations?.find((f) => f.operationId === operationId)?.access,
  );
  const carried = useMyCarried();
  return useCallback(
    (seatId: string) => {
      if (access && !hasOperationAccess(access, "spawn")) {
        toast({ kind: "info", message: "You can watch this operation but not spawn henchmen." });
        return;
      }
      // A carried board card goes down on the desk and prefills the dialog (#36).
      if (carried) {
        dropCard(seatId);
        openSpawn(seatId, carriedPrefill(carried));
        return;
      }
      openSpawn(seatId);
    },
    [openSpawn, toast, access, carried],
  );
}

/**
 * Invisible click targets over each desk's chair (not the desk top, so the
 * laptop keeps its own click): a free desk opens the spawn dialog (and walks
 * the player over), an occupied one the henchman's panel.
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
  const scope = useRoomScope();
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
          walkInRoom(scope, seat.pose.x, seat.pose.z);
          onSpawn(seat.id);
        };
        return (
          <mesh
            key={seat.id}
            name={`desk-hotspot-${seat.id}`}
            // Hit target only: invisible objects still take pointer events but cost no draw call.
            visible={false}
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

export function HenchmanLayer({
  template,
  henchmen: given,
  anchorsFor = sitAnchors,
}: HenchmanLayerProps) {
  const scope = useRoomScope();
  const live = scope.store((s) => s.state?.henchmen ?? EMPTY);
  const henchmen = given ?? live;
  const overrides = useHenchmanOverrides((s) => s.overrides);
  const reducedMotion = useUiStore(selectReducedMotion);
  const volume = useUiStore((s) => s.settings.volume);
  const openSpawn = useOpenSpawn();

  const deskSeats = useMemo(() => template.seats.filter((s) => s.kind === "desk"), [template]);
  const seatsById = useMemo(() => new Map(template.seats.map((s) => [s.id, s])), [template]);
  const anchors = useMemo(() => anchorsFor(template), [anchorsFor, template]);
  const occupiedKey = Object.values(henchmen)
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
      (detail: HotkeyEventDetail) => {
        if (detail.id !== "interact" || !scope.interactive) return;
        const player = playerInRoom(scope);
        if (!player.spawned) return;
        const seat = freeDeskAt(deskSeats, player, (id) => occupied.has(id));
        if (seat) {
          detail.handled = true;
          openSpawn(seat.id);
        }
      },
      [deskSeats, occupied, openSpawn, scope],
    ),
  );

  // Confetti when a henchman starts to celebrate (Henchman calls back once its dance shows).
  const confetti = useMemo(() => createConfettiBus(), []);
  const burst = useCallback(
    (seat: Seat) => {
      if (!reducedMotion) confetti.pending.push({ x: seat.pose.x, y: 1.7, z: seat.pose.z });
    },
    [confetti, reducedMotion],
  );
  // The merge gong rang: a little confetti over every henchman in the operation.
  const seatsOfHenchmen = useRef<Seat[]>([]);
  useEffect(
    () =>
      useGongStore.subscribe((s, prev) => {
        if (!s.ring || s.ring.id === prev.ring?.id || reducedMotion || !scope.interactive) return;
        for (const seat of seatsOfHenchmen.current) {
          confetti.pending.push({
            x: seat.pose.x,
            y: 1.9,
            z: seat.pose.z,
            count: HENCHMAN_CONFETTI,
          });
        }
      }),
    [confetti, reducedMotion, scope],
  );
  // A ding when a hand goes up (in the room the player is in).
  const ding = useMemo(() => createDingGate(), []);
  const prev = useRef<Readonly<Record<string, HenchmanState>>>({});
  useEffect(() => {
    const before = prev.current;
    prev.current = henchmen;
    let rang = false;
    for (const r of Object.values(henchmen)) {
      const old = before[r.agentId];
      if (!rang && scope.interactive && raisesHand(old, r)) {
        rang = true;
        if (ding({ now: performance.now(), volume, reducedMotion })) playDing(volume);
      }
    }
  }, [henchmen, reducedMotion, volume, ding, scope]);

  const visible = useMemo(
    () =>
      Object.values(henchmen).filter((r) => !(r.agentId in overrides) && seatsById.has(r.seatId)),
    [henchmen, overrides, seatsById],
  );
  seatsOfHenchmen.current = visible.map((r) => seatsById.get(r.seatId) as Seat);
  const sources = useMemo<BubbleSource[]>(
    () =>
      visible.map((r) => ({
        agentId: r.agentId,
        bubbleEmits: r.bubbleEmits,
        origin: laptopOrigin(template, seatsById.get(r.seatId) as Seat),
      })),
    [visible, seatsById, template],
  );

  // Floor decals are specks at the overview: leave them out there (#190, one draw each).
  const far = useVisibleStore((s) => s.far);

  return (
    <group name={scopedName(scope, "henchmen")}>
      {visible.map((r) => {
        const seat = seatsById.get(r.seatId) as Seat;
        return (
          <group key={r.agentId}>
            <Henchman
              henchman={r}
              seat={seat}
              anchor={anchors.get(seat.id) ?? FALLBACK_ANCHOR}
              reducedMotion={reducedMotion}
              onSelect={scope.interactive ? openAgentPanel : undefined}
              onCelebrate={burst}
            />
            {!far && <NameDecal seat={seat} ownerName={r.ownerName} model={r.model} />}
          </group>
        );
      })}
      {scope.interactive && (
        <DeskHotspots seats={deskSeats} agentAt={agentAt} onSpawn={openSpawn} />
      )}
      {!reducedMotion && scope.interactive && <WorkBubbles sources={sources} />}
      {!reducedMotion && <Confetti bus={confetti} />}
    </group>
  );
}
