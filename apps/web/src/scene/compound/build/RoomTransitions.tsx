/**
 * Plays room transitions (#187, transitions.ts): pieces that go sink into
 * the floor, pieces that come rise from it, dust over the footprint, and a
 * shaking heap of rubble when a room is demolished. Each playing transition
 * is two or three instanced piece sets for a second or two. With reduced
 * motion nothing plays: rooms simply change.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { PieceSet } from "../../lair/components/InstancedPieces.tsx";
import { Dust } from "../../lair/particles/BuildParticles.tsx";
import type { PiecePlacement } from "../../lair/placements.ts";
import type { PlacedRoom } from "../placed.ts";
import { diffRooms, holdArrivals, type RoomTransition, transitionScales } from "./transitions.ts";

interface Playing extends RoomTransition {
  /** performance.now() at the start, ms. */
  start: number;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * The rooms to draw (arrivals held out while they rise) and the transitions
 * playing. A transition starts when the rooms change, never on the first render.
 */
export function useRoomTransitions(
  rooms: readonly PlacedRoom[],
  reduced: boolean,
): { rooms: readonly PlacedRoom[]; playing: readonly Playing[] } {
  const memo = useRef<{ prev: readonly PlacedRoom[] | null; list: Playing[]; seq: number }>({
    prev: null,
    list: [],
    seq: 0,
  });
  const [tick, setTick] = useState(0);
  const playing = useMemo(() => {
    void tick;
    const s = memo.current;
    const t = now();
    s.list = reduced ? [] : s.list.filter((p) => t < p.start + p.seconds * 1000);
    if (s.prev && s.prev !== rooms && !reduced) {
      for (const tr of diffRooms(s.prev, rooms, ++s.seq)) {
        // A new change to a room replaces what it was still playing.
        s.list = s.list.filter((p) => p.roomId !== tr.roomId || tr.kind === "grow");
        s.list.push({ ...tr, start: t });
      }
    }
    s.prev = rooms;
    return [...s.list];
  }, [rooms, reduced, tick]);
  useEffect(() => {
    if (playing.length === 0) return;
    const end = Math.max(...playing.map((p) => p.start + p.seconds * 1000));
    const h = setTimeout(() => setTick((n) => n + 1), Math.max(0, end - now()) + 30);
    return () => clearTimeout(h);
  }, [playing]);
  const shown = useMemo(() => holdArrivals(rooms, playing), [rooms, playing]);
  return { rooms: shown, playing };
}

/** A few rubble heaps over a demolished room's floor. */
function rubbleFor(t: RoomTransition): PiecePlacement[] {
  const { x, z, w, d } = t.footprint;
  const out: PiecePlacement[] = [];
  for (let i = 0; i < 6; i++) {
    const u = ((i * 37) % 10) / 10;
    const v = ((i * 61) % 10) / 10;
    out.push({
      piece: "rock_pile",
      position: [x + w * (0.15 + 0.7 * u), 0, z + d * (0.15 + 0.7 * v)],
      rotationY: i * 1.3,
      scale: [1.4, 1.4, 1.4],
    });
  }
  return out;
}

function TransitionView({ t }: { t: Playing }) {
  const out = useRef<Group>(null);
  const into = useRef<Group>(null);
  const rubble = useRef<Group>(null);
  const heap = useMemo(() => (t.kind === "demolish" ? rubbleFor(t) : []), [t]);
  const dust = useMemo(
    () => ({
      center: [t.footprint.x + t.footprint.w / 2, 1.2, t.footprint.z + t.footprint.d / 2] as [
        number,
        number,
        number,
      ],
      size: [t.footprint.w, 2.4, t.footprint.d] as [number, number, number],
    }),
    [t],
  );
  useFrame(() => {
    const el = (now() - t.start) / 1000;
    const s = transitionScales(t.kind, el, t.seconds);
    if (out.current) {
      out.current.scale.y = Math.max(0.001, s.departing);
      out.current.visible = s.departing > 0.002;
      // Demolition shakes as it comes down.
      out.current.position.x = t.kind === "demolish" ? Math.sin(el * 55) * 0.06 * s.departing : 0;
    }
    if (into.current) {
      into.current.scale.y = Math.max(0.001, s.arriving);
      into.current.visible = s.arriving > 0.002;
    }
    if (rubble.current) {
      const f = el / t.seconds;
      const h = f < 0.3 ? f / 0.3 : f > 0.75 ? Math.max(0, (1 - f) / 0.25) : 1;
      rubble.current.scale.y = Math.max(0.001, h);
    }
  });
  const dusty = t.kind !== "grow";
  return (
    <group name={`room-transition-${t.kind}`} userData={{ roomId: t.roomId, kind: t.kind }}>
      {t.departures.length > 0 && (
        <group ref={out}>
          <PieceSet items={t.departures} />
        </group>
      )}
      {t.arrivals.length > 0 && (
        <group ref={into} scale-y={0.001}>
          <PieceSet items={t.arrivals} />
        </group>
      )}
      {heap.length > 0 && (
        <group ref={rubble} scale-y={0.001}>
          <PieceSet items={heap} />
        </group>
      )}
      {dusty && <Dust box={dust} count={70} size={0.6} seed={t.start % 97} />}
    </group>
  );
}

export function RoomTransitions({ playing }: { playing: readonly Playing[] }) {
  return (
    <group name="room-transitions">
      {playing.map((t) => (
        <TransitionView key={t.key} t={t} />
      ))}
    </group>
  );
}
