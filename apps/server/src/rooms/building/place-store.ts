/**
 * Where each person last stood (#262), kept per person on the server so it
 * follows them across devices. One row per person (`user_places`), rewritten
 * in place. What is stored is a wish, never an answer: return-place.ts
 * decides at join time whether the person may be there.
 */
import { eq } from "drizzle-orm";
import { type Db, userPlaces } from "../../db/index.ts";
import type { ReturnPlace } from "./return-place.ts";

export interface PlaceStore {
  /** The remembered place, or null when there is none. */
  load(userId: string): ReturnPlace | null;
  save(userId: string, place: ReturnPlace): void;
  /** Forget it: the person arrives in the lobby next time. */
  clear(userId: string): void;
}

export class DrizzlePlaceStore implements PlaceStore {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  load(userId: string): ReturnPlace | null {
    const row = this.#db.select().from(userPlaces).where(eq(userPlaces.userId, userId)).get();
    if (!row) return null;
    return {
      levelId: row.levelId,
      operationId: row.operationId,
      x: row.x,
      z: row.z,
      heading: row.heading,
    };
  }

  save(userId: string, place: ReturnPlace): void {
    const { levelId, operationId, x, z, heading } = place;
    this.#db
      .insert(userPlaces)
      .values({ userId, levelId, operationId, x, z, heading })
      .onConflictDoUpdate({
        target: userPlaces.userId,
        set: { levelId, operationId, x, z, heading, updatedAt: new Date() },
      })
      .run();
  }

  clear(userId: string): void {
    this.#db.delete(userPlaces).where(eq(userPlaces.userId, userId)).run();
  }
}

/** In memory, for tests and harnesses without a database. */
export class MemoryPlaceStore implements PlaceStore {
  readonly places = new Map<string, ReturnPlace>();

  load(userId: string): ReturnPlace | null {
    return this.places.get(userId) ?? null;
  }

  save(userId: string, place: ReturnPlace): void {
    this.places.set(userId, { ...place });
  }

  clear(userId: string): void {
    this.places.delete(userId);
  }
}
