/**
 * Where the FloorRoom reads its floor from, and who may enter it. The
 * Drizzle implementation reads `floors`, `floor_repos` and `desks`; access
 * follows apps/server/src/floors/access.ts (view or better).
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { desks, floorRepos, floors } from "../../db/schema/index.ts";
import { floorAccessFor } from "../../floors/access.ts";
import type { RoomAuthUser } from "../auth.ts";
import type { FloorSnapshot } from "./state.ts";

export interface FloorRoomSource {
  /** The live floor, or undefined when it does not exist or is archived. */
  loadFloor(floorId: string): FloorSnapshot | undefined;
  /** True when `user` has at least `view` access to the live floor. */
  canEnter(user: RoomAuthUser, floorId: string): boolean;
}

export class DrizzleFloorRoomSource implements FloorRoomSource {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  loadFloor(floorId: string): FloorSnapshot | undefined {
    const floor = this.#db
      .select()
      .from(floors)
      .where(and(eq(floors.id, floorId), isNull(floors.archivedAt)))
      .get();
    if (!floor) return undefined;
    const repos = this.#db
      .select()
      .from(floorRepos)
      .where(eq(floorRepos.floorId, floorId))
      .orderBy(asc(floorRepos.createdAt))
      .all()
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    const deskRows = this.#db
      .select({ seatId: desks.seatId, agentId: desks.agentId })
      .from(desks)
      .where(eq(desks.floorId, floorId))
      .orderBy(asc(desks.seatId))
      .all();
    return {
      floorId: floor.id,
      name: floor.name,
      slug: floor.slug,
      paletteId: floor.paletteId,
      layoutTemplateId: floor.layoutTemplateId,
      repos: repos.map((r) => ({
        repoId: r.id,
        owner: r.owner,
        name: r.name,
        defaultBranch: r.defaultBranch,
        isPrimary: r.isPrimary,
      })),
      desks: deskRows.map((d) => ({ seatId: d.seatId, agentId: d.agentId ?? "" })),
    };
  }

  canEnter(user: RoomAuthUser, floorId: string): boolean {
    return floorAccessFor(this.#db, { id: user.userId, role: user.role }, floorId) !== null;
  }
}
