/**
 * Where the OperationRoom reads its operation from, and who may enter it. The
 * Drizzle implementation reads `operations`, `operation_repos` and `desks`; access
 * follows apps/server/src/operations/access.ts (view or better).
 */
import type { OperationAccess } from "@regulus/protocol";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { desks, operationRepos, operations } from "../../db/schema/index.ts";
import { operationAccessFor } from "../../operations/access.ts";
import type { RoomAuthUser } from "../auth.ts";
import type { OperationSnapshot } from "./state.ts";

export interface OperationRoomSource {
  /** The live operation, or undefined when it does not exist or is archived. */
  loadOperation(operationId: string): OperationSnapshot | undefined;
  /** True when `user` has at least `view` access to the live operation. */
  canEnter(user: RoomAuthUser, operationId: string): boolean;
  /** The user's access to the live operation (card carry needs `spawn`, #36); null: none. */
  accessOf?(user: RoomAuthUser, operationId: string): OperationAccess | null;
}

export class DrizzleOperationRoomSource implements OperationRoomSource {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  loadOperation(operationId: string): OperationSnapshot | undefined {
    const operation = this.#db
      .select()
      .from(operations)
      .where(and(eq(operations.id, operationId), isNull(operations.archivedAt)))
      .get();
    if (!operation) return undefined;
    const repos = this.#db
      .select()
      .from(operationRepos)
      .where(eq(operationRepos.operationId, operationId))
      .orderBy(asc(operationRepos.createdAt))
      .all()
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    const deskRows = this.#db
      .select({ seatId: desks.seatId, agentId: desks.agentId })
      .from(desks)
      .where(eq(desks.operationId, operationId))
      .orderBy(asc(desks.seatId))
      .all();
    return {
      operationId: operation.id,
      name: operation.name,
      slug: operation.slug,
      paletteId: operation.paletteId,
      layoutTemplateId: operation.layoutTemplateId,
      deskCount: operation.deskCount,
      decorStyle: operation.decorStyle,
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

  canEnter(user: RoomAuthUser, operationId: string): boolean {
    return this.accessOf(user, operationId) !== null;
  }

  accessOf(user: RoomAuthUser, operationId: string): OperationAccess | null {
    return operationAccessFor(this.#db, { id: user.userId, role: user.role }, operationId);
  }
}
