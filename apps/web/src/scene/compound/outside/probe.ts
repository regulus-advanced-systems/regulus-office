/**
 * The outside's e2e probe (#188), published on `window.__regulusOutside`
 * with `?stats` like `__regulusNav`: the shared door state and what the door
 * shows, the points a flow walks to (the buttons, the doorway, the beach,
 * the dock), whether a point is walkable on the player's current nav grid,
 * and whether the beach is being drawn.
 */
import { usePlayerStore } from "../../../state/player.ts";
import { doorView } from "./BlastDoor.tsx";
import { currentDoor } from "./doorState.ts";
import { dockPoint, type OutsideLayout } from "./layout.ts";
import { outsideView } from "./Outside.tsx";

type Point = { x: number; z: number };

export interface OutsideProbe {
  door(): {
    phase: string;
    presses: number;
    openedBy: string;
    /** The leaves: 0 shut .. 1 open. */
    travel: number;
    alarm: boolean;
    moving: boolean;
  };
  points(): {
    insideButton: Point;
    outsideButton: Point;
    /** On the wall line, in the middle of the doorway. */
    doorway: Point;
    /** Just inside the doorway, in the lobby. */
    lobby: Point;
    beach: Point;
    dock: Point;
    dockEnd: Point;
  } | null;
  walkable(x: number, z: number): boolean;
  /** Is the beach drawn now (culling). */
  drawn(): boolean;
}

declare global {
  interface Window {
    __regulusOutside?: OutsideProbe;
  }
}

export function createOutsideProbe(getLayout: () => OutsideLayout | null): OutsideProbe {
  return {
    door() {
      const d = currentDoor();
      return {
        phase: d.phase,
        presses: d.presses,
        openedBy: d.openedBy,
        travel: doorView.travel,
        alarm: doorView.alarm,
        moving: doorView.moving,
      };
    },
    points() {
      const l = getLayout();
      if (!l) return null;
      const [inside, outside] = l.buttons;
      return {
        insideButton: inside.stand,
        outsideButton: outside.stand,
        doorway: { x: l.door.centre, z: l.edgeZ },
        lobby: { x: l.door.centre, z: l.edgeZ - 2 },
        beach: { x: l.door.centre, z: l.edgeZ + 4 },
        dock: dockPoint(l, 0.45),
        dockEnd: dockPoint(l, 1),
      };
    },
    walkable(x, z) {
      return usePlayerStore.getState().navigation?.walkable(x, z) ?? false;
    },
    drawn: () => outsideView.drawn,
  };
}
