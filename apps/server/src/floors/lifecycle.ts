/**
 * Archive, restore and delete floors (#150; SPEC §9.1 "removed/archived with
 * the project"). Office owners and admins only; floor managers cannot.
 *
 * - Archive hides the floor (elevator, building list) and closes its
 *   FloorRoom; rows and files stay. Restore brings it back as it was.
 * - Delete is permanent and refused while robots are on the floor (a desk
 *   held, or a process believed running). It archives first, so nothing new
 *   can start there, then removes the files ({@link FloorDirRemover}: the
 *   floor mirrors and every human's clones and worktrees, nothing outside
 *   those two dirs), then the rows (floor, repos, members, desks, agents and
 *   their events, tasks, decor, whiteboard, floor chat). The audit log is
 *   kept. Nothing on GitHub is touched. If the files cannot be removed the
 *   floor stays archived and the delete can be retried.
 */
import type { FloorInfo, FloorRobotInfo } from "@regulus/protocol";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { isLive } from "../agents/manager/state-machine.ts";
import { AUDIT_ACTIONS, type DbOrTx, writeAudit } from "../auth/audit.ts";
import { AuthHttpError, forbidden } from "../auth/errors.ts";
import type { Db } from "../db/index.ts";
import {
  agents,
  chatMessages,
  desks,
  floorRepos,
  floors,
  userProfiles,
} from "../db/schema/index.ts";
import type { Logger } from "../logging.ts";
import type { FloorDirRemover } from "../worktrees/floor-dirs.ts";
import { type FloorActor, isOfficeManager } from "./access.ts";
import { floorInfo } from "./info.ts";

/** Sends one robot home keeping its branch (the AgentManager, wired at boot). */
export interface FloorRobots {
  sendHome(actor: FloorActor, agentId: string): Promise<void>;
}

export interface FloorLifecycleDeps {
  db: Db;
  logger: Logger;
  dirs: FloorDirRemover;
  onChange?(floorId: string): void;
}

type FloorRow = typeof floors.$inferSelect;

const notFound = () => new AuthHttpError(404, "floor_not_found");

function requireManager(actor: FloorActor): void {
  if (!isOfficeManager(actor.role)) throw forbidden("owner_or_admin_required");
}

/** Robots still on the floor: holding a desk, or with a process believed running. */
export function robotsOn(db: DbOrTx, floorId: string): FloorRobotInfo[] {
  const seated = db
    .select({ id: desks.agentId })
    .from(desks)
    .where(and(eq(desks.floorId, floorId), isNotNull(desks.agentId)))
    .all()
    .map((d) => d.id as string);
  const rows = db
    .select({
      agentId: agents.id,
      ownerUserId: agents.ownerUserId,
      ownerName: userProfiles.displayName,
      status: agents.status,
      taskTitle: agents.taskTitle,
    })
    .from(agents)
    .leftJoin(userProfiles, eq(userProfiles.userId, agents.ownerUserId))
    .where(eq(agents.floorId, floorId))
    .orderBy(asc(agents.createdAt))
    .all();
  return rows
    .filter((r) => seated.includes(r.agentId) || isLive(r.status))
    .map((r) => ({
      ...r,
      ownerName: r.ownerName ?? "someone",
      taskTitle: r.taskTitle.slice(0, 500),
      running: isLive(r.status),
    }));
}

export class FloorLifecycle {
  readonly #deps: FloorLifecycleDeps;
  /** Late-bound: the AgentManager is created after the floors. */
  robots: FloorRobots | undefined;
  readonly #deleting = new Set<string>();

  constructor(deps: FloorLifecycleDeps) {
    this.#deps = deps;
  }

  get #db() {
    return this.#deps.db;
  }

  #row(floorId: string): FloorRow {
    const row = this.#db.select().from(floors).where(eq(floors.id, floorId)).get();
    if (!row) throw notFound();
    return row;
  }

  /** Archived floors, newest first (Settings → Floors). */
  listArchived(actor: FloorActor): FloorInfo[] {
    requireManager(actor);
    return this.#db
      .select()
      .from(floors)
      .where(isNotNull(floors.archivedAt))
      .all()
      .sort((a, b) => (b.archivedAt?.getTime() ?? 0) - (a.archivedAt?.getTime() ?? 0))
      .map((row) => floorInfo(this.#db, row, "manage"));
  }

  restore(actor: FloorActor, floorId: string): FloorInfo {
    requireManager(actor);
    const row = this.#row(floorId);
    if (!row.archivedAt) throw new AuthHttpError(409, "floor_not_archived");
    if (this.#deleting.has(floorId)) throw new AuthHttpError(409, "floor_busy");
    this.#db.transaction((tx) => {
      tx.update(floors).set({ archivedAt: null }).where(eq(floors.id, floorId)).run();
      writeAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.floorRestore,
        targetKind: "floor",
        targetId: floorId,
        meta: { name: row.name, slug: row.slug },
      });
    });
    this.#deps.onChange?.(floorId);
    return floorInfo(this.#db, this.#row(floorId), "manage");
  }

  /** "Send all home" before a delete: every robot on the floor, branches kept. */
  async sendAllHome(
    actor: FloorActor,
    floorId: string,
  ): Promise<{ sentHome: number; failed: { agentId: string; reason: string }[] }> {
    requireManager(actor);
    this.#row(floorId);
    const robots = this.robots;
    if (!robots) throw new AuthHttpError(503, "robots_unavailable");
    let sentHome = 0;
    const failed: { agentId: string; reason: string }[] = [];
    for (const robot of robotsOn(this.#db, floorId)) {
      try {
        await robots.sendHome(actor, robot.agentId);
        sentHome += 1;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "could not be sent home";
        failed.push({ agentId: robot.agentId, reason: reason.slice(0, 500) });
      }
    }
    return { sentHome, failed };
  }

  async delete(actor: FloorActor, floorId: string, confirmName: string): Promise<string[]> {
    requireManager(actor);
    const row = this.#row(floorId);
    if (confirmName.trim() !== row.name.trim()) {
      throw new AuthHttpError(400, "confirm_name_mismatch");
    }
    if (this.#deleting.has(floorId)) throw new AuthHttpError(409, "floor_busy");
    this.#deleting.add(floorId);
    try {
      return await this.#delete(actor, row);
    } finally {
      this.#deleting.delete(floorId);
    }
  }

  async #delete(actor: FloorActor, row: FloorRow): Promise<string[]> {
    const floorId = row.id;
    // One write transaction: a spawn admitted before it holds a desk and is
    // seen here; one after it finds the floor archived and is refused.
    const repos = this.#db.transaction(
      (tx) => {
        const robots = robotsOn(tx, floorId);
        if (robots.length > 0) throw new AuthHttpError(409, "floor_has_robots", { robots });
        const list = tx.select().from(floorRepos).where(eq(floorRepos.floorId, floorId)).all();
        if (list.some((r) => r.cloneStatus === "cloning")) {
          throw new AuthHttpError(409, "floor_cloning");
        }
        if (!row.archivedAt) {
          tx.update(floors).set({ archivedAt: new Date() }).where(eq(floors.id, floorId)).run();
          writeAudit(tx, {
            userId: actor.id,
            action: AUDIT_ACTIONS.floorArchive,
            targetKind: "floor",
            targetId: floorId,
            meta: { name: row.name, slug: row.slug, reason: "delete" },
          });
        }
        return list.map((r) => `${r.owner}/${r.name}`);
      },
      { behavior: "immediate" },
    );
    this.#deps.onChange?.(floorId);

    let removed: string[];
    try {
      removed = await this.#deps.dirs.removeFloorDirs(row.slug);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.#deps.logger.error({ floorId, slug: row.slug, err: error }, "floor files not removed");
      writeAudit(this.#db, {
        userId: actor.id,
        action: AUDIT_ACTIONS.floorDelete,
        targetKind: "floor",
        targetId: floorId,
        meta: { name: row.name, slug: row.slug, repos, ok: false },
      });
      throw new AuthHttpError(500, "floor_files_not_removed");
    }

    this.#db.transaction((tx) => {
      tx.delete(chatMessages).where(eq(chatMessages.floorId, floorId)).run();
      // Cascades: repos, members, desks, agents (+ events, services), tasks, decor, whiteboards.
      tx.delete(floors).where(eq(floors.id, floorId)).run();
      writeAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.floorDelete,
        targetKind: "floor",
        targetId: floorId,
        meta: { name: row.name, slug: row.slug, repos, removed, ok: true },
      });
    });
    this.#deps.onChange?.(floorId);
    this.#deps.logger.info({ floorId, slug: row.slug, removed }, "floor deleted");
    return removed;
  }
}
