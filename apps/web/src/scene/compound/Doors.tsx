/**
 * Room doors (#186, SPEC §9.1): a door slides open while the player, or
 * another human, stands near it, but only into a room this viewer may enter
 * that is finished; every other door stays shut (the nav grid keeps it shut
 * too). The lobby's blast door stays shut until #188 wires its button.
 * The door states are stable objects whose `open` flags are flipped in place
 * a few times a second; `SlidingDoors` eases the leaves every frame.
 */
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { useBuildingStore } from "../../state/building.ts";
import { usePlayerStore } from "../../state/player.ts";
import { Beacons } from "../lair/components/Beacons.tsx";
import { type DoorState, SlidingDoors } from "../lair/components/SlidingDoors.tsx";
import type { PlacedRoom } from "./placed.ts";
import { isOpenRoom } from "./world.ts";

/** Doors open for anyone within this many metres of the doorway. */
export const DOOR_OPEN_RADIUS = 3.4;
const CHECK_S = 0.15;

export interface DoorEntry {
  door: DoorState;
  openable: boolean;
}

/** Whether anyone in `people` stands within the open radius of `door`. */
export function someoneNear(
  door: DoorState,
  people: ReadonlyArray<{ x: number; z: number }>,
): boolean {
  const r2 = DOOR_OPEN_RADIUS * DOOR_OPEN_RADIUS;
  return people.some((p) => (p.x - door.position[0]) ** 2 + (p.z - door.position[2]) ** 2 < r2);
}

export function CompoundDoors({
  rooms,
  extra,
}: {
  rooms: readonly PlacedRoom[];
  /** Doors that never open here (the blast door). */
  extra: readonly DoorState[];
}) {
  const entries = useMemo<DoorEntry[]>(
    () => [
      ...rooms.flatMap((r) => r.doors.map((door) => ({ door, openable: isOpenRoom(r.room) }))),
      ...extra.map((door) => ({ door, openable: false })),
    ],
    [rooms, extra],
  );
  const doors = useMemo(() => entries.map((e) => e.door), [entries]);
  const beacons = useMemo(() => rooms.flatMap((r) => r.beacons), [rooms]);
  const since = useRef(0);
  useFrame((_, dt) => {
    since.current += dt;
    if (since.current < CHECK_S) return;
    since.current = 0;
    const me = usePlayerStore.getState();
    const people: { x: number; z: number }[] = me.spawned ? [{ x: me.x, z: me.z }] : [];
    const building = useBuildingStore.getState();
    for (const [sid, h] of Object.entries(building.state?.humans ?? {}))
      if (sid !== building.sessionId) people.push(h.position);
    for (const e of entries) e.door.open = e.openable && someoneNear(e.door, people);
  });
  return (
    <group name="compound-doors">
      <SlidingDoors doors={doors} />
      <Beacons items={beacons} active={false} lights={0} />
    </group>
  );
}
