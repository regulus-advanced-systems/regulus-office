/**
 * The blast door on the client (#188): its shared phase from the
 * BuildingRoom (protocol `blast-door.ts`), the heavy leaves' motion, and
 * when the alarm runs. The dev harness can force a phase (`?door=`) through
 * the override store. Pure helpers plus two tiny stores.
 */
import {
  BLAST_DOOR_CLOSED,
  type BlastDoorPhase,
  type BlastDoorState,
  blastDoorPassable,
} from "@regulus/protocol";
import { create } from "zustand";
import { useBuildingStore } from "../../../state/building.ts";

/** Seconds the leaves take to travel all the way (a heavy door). */
export const DOOR_TRAVEL_S = 4.2;
/** Seconds the bolts take to draw before the leaves move (the leaves shudder, nothing slides). */
export const DOOR_UNLOCK_S = 0.7;
/** The alarm keeps sweeping this long after the door has shut. */
export const ALARM_TAIL_S = 2.5;

export interface DoorOverride {
  /** A forced phase (dev harness); null follows the BuildingRoom. */
  phase: BlastDoorPhase | null;
  /** Force the alarm on (the "closed with the alarm" view). */
  alarm: boolean;
  set: (o: { phase: BlastDoorPhase | null; alarm?: boolean }) => void;
}

export const useDoorOverride = create<DoorOverride>()((set) => ({
  phase: null,
  alarm: false,
  set: (o) => set({ phase: o.phase, alarm: o.alarm ?? false }),
}));

/** The shared door state (or the harness's forced phase). */
export function currentDoor(): BlastDoorState {
  const o = useDoorOverride.getState();
  const shared = useBuildingStore.getState().state?.blastDoor ?? BLAST_DOOR_CLOSED;
  return o.phase ? { ...shared, phase: o.phase } : shared;
}

/** The door's phase as a React value. */
export function useDoorPhase(): BlastDoorPhase {
  const forced = useDoorOverride((s) => s.phase);
  const shared = useBuildingStore((s) => s.state?.blastDoor?.phase ?? "closed");
  return forced ?? shared;
}

/** Is the doorway walkable (the nav grid follows this)? */
export function useDoorPassable(): boolean {
  return blastDoorPassable(useDoorPhase());
}

/** The leaves' motion: `travel` 0 shut .. 1 open, plus the unlock wait before they move. */
export interface LeafMotion {
  travel: number;
  /** Seconds left drawing the bolts before the leaves start to open. */
  unlock: number;
  /** The target the leaves last headed for. */
  open: boolean;
}

export const SHUT: LeafMotion = { travel: 0, unlock: 0, open: false };

/** Advance the leaves toward `open` by `dt` seconds. */
export function stepLeaves(m: LeafMotion, open: boolean, dt: number): LeafMotion {
  let unlock = m.unlock;
  if (open && !m.open && m.travel === 0) unlock = DOOR_UNLOCK_S;
  if (unlock > 0) {
    unlock = Math.max(0, unlock - dt);
    return { travel: m.travel, unlock, open };
  }
  const step = dt / DOOR_TRAVEL_S;
  const travel = open ? Math.min(1, m.travel + step) : Math.max(0, m.travel - step);
  return { travel, unlock: 0, open };
}

/** Eased leaf offset (0..1 of a leaf's width): slow to start, slow to stop, like a heavy slab. */
export function leafOffset(travel: number): number {
  const t = Math.min(1, Math.max(0, travel));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Is the leaf moving (or shuddering on its bolts)? */
export function leavesMoving(m: LeafMotion): boolean {
  return m.unlock > 0 || (m.open ? m.travel < 1 : m.travel > 0);
}

/**
 * Does the alarm run: while the door is open or warning it will shut, while
 * the leaves move, and for a moment after it has shut.
 */
export function alarmOn(
  phase: BlastDoorPhase,
  motion: LeafMotion,
  sinceShut: number,
  forced = false,
): boolean {
  return forced || phase !== "closed" || leavesMoving(motion) || sinceShut < ALARM_TAIL_S;
}
