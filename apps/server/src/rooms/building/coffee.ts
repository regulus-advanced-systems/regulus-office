/**
 * The break-room coffee machine in the BuildingRoom (SPEC §9.1, D9; #63,
 * protocol `coffee.ts`). A cup is granted only to a human standing at the
 * machine on the lobby level (their last published pose), at most once per
 * cooldown; it sets `cups` and `buzzUntil` on their own presence, which
 * reaches other people only as far as the person does (viewers.ts). The
 * room's sweep calls `tick`, which ends a buzz that ran out.
 *
 * The buzz changes nothing the server accepts: `move` is taken at any speed
 * (commands.ts checks the world's bounds, room.ts the rate), so a buzzed
 * client that walks faster is never corrected or held back.
 */
import {
  afterCup,
  COFFEE_COOLDOWN_MS,
  COFFEE_SERVER_REACH,
  LOBBY_LEVEL_ID,
} from "@regulus/protocol";
import { type CoffeeCompound, coffeeMachineSpot } from "@regulus/room-layout";

/** The presence fields the machine reads and writes. */
export interface Drinker {
  levelId: string;
  position: { x: number; z: number };
  cups: number;
  buzzUntil: number;
}

export type DrinkResult = { ok: true; cups: number } | { ok: false; reason: string };

export interface CoffeeMachine {
  /** One cup for the human of `sessionId`, if they stand at the machine. */
  drink(sessionId: string, human: Drinker, lobbyLevel: CoffeeCompound | undefined): DrinkResult;
  /** End every buzz that ran out; cheap, called from the room's sweep. */
  tick(humans: { forEach(cb: (human: Drinker) => void): void }): void;
  forget(sessionId: string): void;
}

export function createCoffeeMachine(now: () => number): CoffeeMachine {
  const lastCup = new Map<string, number>();
  return {
    drink(sessionId, human, lobbyLevel) {
      const spot = lobbyLevel ? coffeeMachineSpot(lobbyLevel) : null;
      // The break room is on the lobby level; the same spot elsewhere is another place (#269).
      const near =
        spot !== null &&
        human.levelId === LOBBY_LEVEL_ID &&
        Math.hypot(human.position.x - spot.stand.x, human.position.z - spot.stand.z) <=
          COFFEE_SERVER_REACH;
      if (!near) return { ok: false, reason: "Walk up to the coffee machine in the break room." };
      const t = now();
      const last = lastCup.get(sessionId);
      if (last !== undefined && t - last < COFFEE_COOLDOWN_MS)
        return { ok: false, reason: "Finish that cup first." };
      lastCup.set(sessionId, t);
      const next = afterCup(human, t);
      human.cups = next.cups;
      human.buzzUntil = next.buzzUntil;
      return { ok: true, cups: next.cups };
    },
    tick(humans) {
      const t = now();
      humans.forEach((human) => {
        if (human.cups === 0 && human.buzzUntil === 0) return;
        if (t < human.buzzUntil) return;
        human.cups = 0;
        human.buzzUntil = 0;
      });
    },
    forget(sessionId) {
      lastCup.delete(sessionId);
    },
  };
}
