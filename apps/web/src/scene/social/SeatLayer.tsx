/**
 * Sitting down (#49): every chair and couch humans may take (seats.ts) gets
 * an invisible click target; a click walks over and sits on arrival, `E`
 * sits on the nearest free seat in reach, and `E` again (or walking off)
 * stands up. The server keeps one human per seat and refuses seats out of
 * reach or behind doors this human may not open; a refusal comes back as a
 * toast. A ring on the floor marks the seat `E` would take.
 */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import type { CommandRejected } from "@regulus/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getOfficeClient } from "../../net/index.ts";
import { selectSelf, useBuildingStore } from "../../state/building.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { usePlayerStore } from "../../state/player.ts";
import { useUiStore } from "../../state/ui.ts";
import type { HotkeyEventDetail } from "../../ui/hotkeys/registry.ts";
import { useHotkeyEvents } from "../../ui/hotkeys/useHotkeys.ts";
import { type HumanSeat, nearestFreeSeat, SIT_KEY_REACH, takenSeats, worldSeats } from "./seats.ts";

/** Send `sit`; false when the building room is not joined (dev harnesses). */
export function sendSit(seatId: string | null): boolean {
  try {
    getOfficeClient().send("sit", { seatId });
    return true;
  } catch {
    return false;
  }
}

/** Sit on `seat` now: stop walking first so no later `move` stands us up again. */
export function sitOn(seat: HumanSeat): boolean {
  usePlayerStore.getState().clearTarget();
  return sendSit(seat.key);
}

const RING_Y = 0.02;

export function SeatLayer() {
  const world = useCompoundStore((s) => s.world);
  const seats = useMemo(() => (world ? worldSeats(world) : []), [world]);
  const taken = useBuildingStore(useShallow((s) => [...takenSeats(s.state, s.sessionId)].sort()));
  const mySeat = useBuildingStore((s) => selectSelf(s)?.seatId ?? "");
  const takenSet = useMemo(() => new Set(taken), [taken]);
  const pending = useRef<HumanSeat | null>(null);
  const [inReach, setInReach] = useState<string | null>(null);

  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      off = getOfficeClient().onRejected((r: CommandRejected) => {
        if (r.type !== "sit") return;
        useUiStore
          .getState()
          .toast({ kind: "warning", title: "Can't sit there", message: r.reason });
      });
    } catch {
      off = undefined;
    }
    return () => off?.();
  }, []);

  // Sit on arrival after a click; the seat `E` would take (for the ring), 4×/s is plenty.
  const since = useRef(0);
  useFrame((_, dt) => {
    const p = usePlayerStore.getState();
    const want = pending.current;
    if (want) {
      const near = Math.hypot(want.x - p.x, want.z - p.z) <= SIT_KEY_REACH;
      if (near && !p.path) {
        pending.current = null;
        sitOn(want);
      } else if (!p.path) pending.current = null; // walked elsewhere, or no route
    }
    since.current += dt;
    if (since.current < 0.25) return;
    since.current = 0;
    const next = p.spawned && !mySeat ? (nearestFreeSeat(seats, p, takenSet)?.key ?? null) : null;
    if (next !== inReach) setInReach(next);
  });

  useHotkeyEvents(
    useCallback(
      (detail: HotkeyEventDetail) => {
        if (detail.id !== "interact" || detail.handled) return;
        const p = usePlayerStore.getState();
        if (!p.spawned) return;
        if (mySeat) {
          detail.handled = true;
          sendSit(null);
          return;
        }
        const seat = nearestFreeSeat(seats, p, takenSet);
        if (!seat) return;
        detail.handled = true;
        sitOn(seat);
      },
      [seats, takenSet, mySeat],
    ),
  );

  const click = (seat: HumanSeat) => (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0 || takenSet.has(seat.key)) return;
    event.stopPropagation();
    const p = usePlayerStore.getState();
    if (Math.hypot(seat.x - p.x, seat.z - p.z) <= SIT_KEY_REACH) {
      sitOn(seat);
      return;
    }
    if (p.setTarget(seat.x, seat.z)) pending.current = seat;
  };

  const ring = seats.find((s) => s.key === inReach);
  return (
    <group name="seats">
      {seats.map((s) => (
        <mesh
          key={s.key}
          name={`seat-${s.key}`}
          // Hit target only: invisible objects still take pointer events but cost no draw call.
          visible={false}
          position={[s.x, 0.45, s.z]}
          rotation-y={s.heading}
          onClick={click(s)}
          onPointerOver={(e) => {
            if (takenSet.has(s.key)) return;
            e.stopPropagation();
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            document.body.style.cursor = "";
          }}
        >
          <boxGeometry args={[0.8, 0.9, 0.8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      ))}
      {ring && (
        <mesh name="seat-in-reach" position={[ring.x, RING_Y, ring.z]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.42, 0.52, 32]} />
          <meshBasicMaterial color="#F2C200" transparent opacity={0.85} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
