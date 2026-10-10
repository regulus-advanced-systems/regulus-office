/**
 * The BuildingRoom's side of "come back where you left" (#262): puts a
 * joining person where they last stood when they may be there now
 * (return-place.ts), else at the lobby spawn, and keeps the remembered place
 * current while they walk and when they leave.
 *
 * A refused place is forgotten at once and the person is told nothing: they
 * arrive in the lobby exactly as someone with no remembered place does, so a
 * room or level they can no longer see leaves no trace (D26, D27).
 */
import { LOBBY_LEVEL_ID, LOBBY_OPERATION_ID } from "@regulus/protocol";
import type { Logger } from "../../logging.ts";
import type { LairView } from "../../operations/access.ts";
import type { PlaceStore } from "./place-store.ts";
import { placeToReturnTo, type ReturnPlace } from "./return-place.ts";
import { placeAtSpawn } from "./spawn.ts";
import type { BuildingState, Human } from "./types.ts";

/** A walking person's place is written at most this often, ms; leaving always writes it. */
export const PLACE_SAVE_EVERY_MS = 5_000;

export interface ReturningDeps {
  /** Absent: nobody is remembered and everyone arrives at the lobby spawn. */
  places?: PlaceStore;
  logger: Logger;
}

const placeOf = (human: Human): ReturnPlace => ({
  levelId: human.levelId || LOBBY_LEVEL_ID,
  operationId: human.operationId || LOBBY_OPERATION_ID,
  x: human.position.x,
  z: human.position.z,
  heading: human.position.heading,
});

/** Changes when the person has moved enough to be worth writing down. */
const keyOf = (p: ReturnPlace): string =>
  `${p.levelId}|${p.operationId}|${p.x.toFixed(2)}|${p.z.toFixed(2)}|${p.heading.toFixed(2)}`;

export function createReturning(deps: ReturningDeps) {
  const { places, logger } = deps;
  /** By session id: the place last written (or found) for it. */
  const written = new Map<string, string>();
  /** Sessions whose place could not be written; said once, not tried again. */
  const failed = new Set<string>();
  let lastFlushAt = 0;

  const write = (sessionId: string, human: Human) => {
    if (!places || failed.has(sessionId)) return;
    const place = placeOf(human);
    const key = keyOf(place);
    if (written.get(sessionId) === key) return;
    try {
      places.save(human.userId, place);
      written.set(sessionId, key);
    } catch (err) {
      failed.add(sessionId);
      logger.warn({ err, userId: human.userId }, "could not remember where this person is");
    }
  };

  return {
    /**
     * Place a person who just joined (or who joined before the lair was
     * published): at the remembered place when `view` allows it, else at the
     * lobby spawn. True when they are back where they left.
     */
    arrive(state: BuildingState, sessionId: string, human: Human, view: LairView): boolean {
      const published = state.compound.width > 0;
      let wish: ReturnPlace | null = null;
      try {
        wish = places?.load(human.userId) ?? null;
      } catch (err) {
        logger.warn({ err, userId: human.userId }, "could not read where this person was");
      }
      const place = wish && published ? placeToReturnTo(state, view, wish) : null;
      if (place) {
        human.levelId = place.levelId;
        human.operationId = place.operationId;
        human.position.x = place.x;
        human.position.z = place.z;
        human.position.heading = place.heading;
      } else {
        // Before the lair is published nothing can be decided: the wish is kept for later.
        if (wish && published) {
          try {
            places?.clear(human.userId);
          } catch (err) {
            logger.warn({ err, userId: human.userId }, "could not forget a refused place");
          }
        }
        human.levelId = LOBBY_LEVEL_ID;
        human.operationId = LOBBY_OPERATION_ID;
        placeAtSpawn(human, state.compound);
      }
      // What is in the store now needs no rewrite until they move.
      written.set(sessionId, keyOf(placeOf(human)));
      return place !== null;
    },

    /** Called from the room's sweep: write down who moved, every {@link PLACE_SAVE_EVERY_MS}. */
    tick(state: BuildingState, now: number): void {
      if (!places || now - lastFlushAt < PLACE_SAVE_EVERY_MS) return;
      lastFlushAt = now;
      state.humans.forEach((human, sessionId) => write(sessionId, human));
    },

    /** A person is leaving: where they stand now is where they come back. */
    leave(sessionId: string, human: Human | undefined): void {
      if (human) write(sessionId, human);
      written.delete(sessionId);
      failed.delete(sessionId);
    },

    clear(): void {
      written.clear();
      failed.clear();
    },
  };
}
