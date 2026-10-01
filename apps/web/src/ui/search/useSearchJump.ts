/**
 * Drives a jump-to-desk (#41): samples the floor, player and floor-list
 * stores a few times a second, asks `nextJumpStep` what to do, and does it —
 * quick travel into the robot's room (#186), click-to-walk to its desk, then
 * open its terminal with the match to reveal. Mount once (SearchHost does).
 */
import { useEffect } from "react";
import { roomLayout } from "../../scene/compound/layouts.ts";
import { roomById } from "../../scene/compound/world.ts";
import { useCompoundStore } from "../../state/compound.ts";
import { useFloorStore } from "../../state/floor.ts";
import { usePlayerStore } from "../../state/player.ts";
import { travelTo } from "../../state/travel.ts";
import { useUiStore } from "../../state/ui.ts";
import { useTerminalModal } from "../terminal/terminalStore.ts";
import { type JumpProgress, type JumpTarget, type JumpWorld, nextJumpStep } from "./jump.ts";
import { useSearchStore } from "./searchStore.ts";

export const JUMP_TICK_MS = 150;

export interface JumpDeps {
  rideTo(floorId: string): void;
  openTerminal(agentId: string): void;
  now(): number;
}

const defaultDeps: JumpDeps = {
  rideTo: (floorId) => void travelTo(floorId, { walkIn: true }),
  openTerminal: (agentId) => useTerminalModal.getState().openTerminal(agentId),
  now: () => Date.now(),
};

/** The world as the jump sees it, read from the stores. */
export function sampleWorld(target: JumpTarget, now: number): JumpWorld {
  const floor = useFloorStore.getState();
  const player = usePlayerStore.getState();
  const state = floor.state?.floorId === target.floorId ? floor.state : null;
  const world = useCompoundStore.getState().world;
  const room = world ? roomById(world, target.floorId) : undefined;
  const layout = room?.kind === "project" ? roomLayout(room) : null;
  const seatId = state?.robots[target.agentId]?.seatId ?? target.seatId;
  const seat = state ? layout?.seats.find((s) => s.id === seatId) : undefined;
  return {
    now,
    floorId: floor.floorId,
    floorLoaded: state !== null,
    playerReady: player.spawned && player.navigation !== null,
    player: { x: player.x, z: player.z },
    walking: player.target !== null,
    // Compound metres: the room's corner plus the seat in the room's frame.
    seat: seat && room ? { x: room.origin.x + seat.pose.x, z: room.origin.z + seat.pose.z } : null,
  };
}

/** Advance one jump by one step; returns false once the jump is over. */
export function tickJump(target: JumpTarget, progress: JumpProgress, deps: JumpDeps): boolean {
  const now = deps.now();
  const step = nextJumpStep(target, sampleWorld(target, now), progress);
  switch (step.kind) {
    case "ride":
      progress.rode = true;
      deps.rideTo(target.floorId);
      return true;
    case "walk":
      progress.walkingSince = now;
      usePlayerStore.getState().setTarget(step.to.x, step.to.z);
      return true;
    case "open":
      useSearchStore
        .getState()
        .setReveal({ agentId: target.agentId, docId: target.docId, query: target.query });
      deps.openTerminal(target.agentId);
      return false;
    case "give_up":
      useUiStore.getState().toast({
        kind: "error",
        message: "Could not reach that henchman's room.",
      });
      return false;
    default:
      return true;
  }
}

export function useSearchJump(deps: JumpDeps = defaultDeps): void {
  const jump = useSearchStore((s) => s.jump);
  useEffect(() => {
    if (!jump) return;
    const progress: JumpProgress = { rode: false, walkingSince: null };
    const run = () => {
      if (!tickJump(jump, progress, deps)) {
        clearInterval(timer);
        useSearchStore.getState().endJump();
      }
    };
    const timer = setInterval(run, JUMP_TICK_MS);
    run();
    return () => clearInterval(timer);
  }, [jump, deps]);
}
