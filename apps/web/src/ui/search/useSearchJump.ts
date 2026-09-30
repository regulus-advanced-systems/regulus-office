/**
 * Drives a jump-to-desk (#41): samples the floor, player and floor-list
 * stores a few times a second, asks `nextJumpStep` what to do, and does it —
 * quick travel to the robot's floor, click-to-walk to its desk, then open
 * its terminal with the match to reveal. Mount once (SearchHost does).
 */
import { useEffect } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { floorViewFor } from "../../scene/floorView.ts";
import { useFloorStore } from "../../state/floor.ts";
import { useFloorsStore } from "../../state/floors.ts";
import { usePlayerStore } from "../../state/player.ts";
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
  rideTo: (floorId) => void getOfficeClient().rideTo(floorId, "teleport"),
  openTerminal: (agentId) => useTerminalModal.getState().openTerminal(agentId),
  now: () => Date.now(),
};

/** The world as the jump sees it, read from the stores. */
export function sampleWorld(target: JumpTarget, now: number): JumpWorld {
  const floor = useFloorStore.getState();
  const player = usePlayerStore.getState();
  const state = floor.state?.floorId === target.floorId ? floor.state : null;
  const info = useFloorsStore.getState().floors?.find((f) => f.floorId === target.floorId);
  const view = floorViewFor(target.floorId, state, info);
  const seatId = state?.robots[target.agentId]?.seatId ?? target.seatId;
  const seat = state ? view.template.seats.find((s) => s.id === seatId) : undefined;
  return {
    now,
    floorId: floor.floorId,
    floorLoaded: state !== null,
    playerReady: player.spawned && player.spawnKey === view.key && player.navigation !== null,
    player: { x: player.x, z: player.z },
    walking: player.target !== null,
    seat: seat ? { x: seat.pose.x, z: seat.pose.z } : null,
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
        message: "Could not reach that robot's floor.",
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
