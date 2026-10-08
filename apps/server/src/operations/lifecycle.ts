/**
 * Archive, restore and delete operations (#150; SPEC §9.1 "removed/archived with
 * the project"). Office owners and admins only; operation managers cannot.
 *
 * - Archive hides the operation (elevator, building list) and closes its
 *   OperationRoom; rows and files stay. Restore brings it back as it was.
 * - Delete is permanent and refused while henchmen are on the operation (a desk
 *   held, or a process believed running). It archives first, so nothing new
 *   can start there, then removes the files ({@link OperationDirRemover}: the
 *   operation mirrors and every human's clones and worktrees, nothing outside
 *   those two dirs), then the rows (operation, repos, members, desks, agents and
 *   their events, tasks, decor, whiteboard, operation chat). The audit log is
 *   kept. Nothing on GitHub is touched. If the files cannot be removed the
 *   operation stays archived and the delete can be retried.
 */
import type { OperationHenchmanInfo, OperationInfo } from "@regulus/protocol";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { isLive } from "../agents/manager/state-machine.ts";
import { AUDIT_ACTIONS, type DbOrTx, writeAudit } from "../auth/audit.ts";
import { AuthHttpError, forbidden } from "../auth/errors.ts";
import type { Db } from "../db/index.ts";
import {
  agents,
  chatMessages,
  desks,
  operationRepos,
  operations,
  userProfiles,
} from "../db/schema/index.ts";
import type { Logger } from "../logging.ts";
import type { OperationDirRemover } from "../worktrees/operation-dirs.ts";
import {
  accessibleArchivedOperations,
  archivedOperationAccessFor,
  isOfficeManager,
  type OperationActor,
  operationAccessFor,
} from "./access.ts";
import { operationDirName, sharesDir } from "./dirs.ts";
import { operationInfo } from "./info.ts";

/** Sends one henchman home keeping its branch (the AgentManager, wired at boot). */
export interface OperationHenchmen {
  sendHome(actor: OperationActor, agentId: string): Promise<void>;
}

export interface OperationLifecycleDeps {
  db: Db;
  logger: Logger;
  dirs: OperationDirRemover;
  onChange?(operationId: string): void;
}

type OperationRow = typeof operations.$inferSelect;

const notFound = () => new AuthHttpError(404, "operation_not_found");

function requireManager(actor: OperationActor): void {
  if (!isOfficeManager(actor.role)) throw forbidden("owner_or_admin_required");
}

/** Henchmen still on the operation: holding a desk, or with a process believed running. */
export function henchmenOn(db: DbOrTx, operationId: string): OperationHenchmanInfo[] {
  const seated = db
    .select({ id: desks.agentId })
    .from(desks)
    .where(and(eq(desks.operationId, operationId), isNotNull(desks.agentId)))
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
    .where(eq(agents.operationId, operationId))
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

export class OperationLifecycle {
  readonly #deps: OperationLifecycleDeps;
  /** Late-bound: the AgentManager is created after the operations. */
  henchmen: OperationHenchmen | undefined;
  readonly #deleting = new Set<string>();

  constructor(deps: OperationLifecycleDeps) {
    this.#deps = deps;
  }

  get #db() {
    return this.#deps.db;
  }

  #row(operationId: string): OperationRow {
    const row = this.#db.select().from(operations).where(eq(operations.id, operationId)).get();
    if (!row) throw notFound();
    return row;
  }

  /**
   * The operation, for an office owner or admin whose own GitHub account can
   * see its repo (D27; #270). The office role is what lets them restore, clear
   * or delete a room; it does not show them a room of a repo they cannot see,
   * so that room is "not found" like any unknown id.
   */
  #managed(actor: OperationActor, operationId: string): OperationRow {
    requireManager(actor);
    const row = this.#row(operationId);
    const access = row.archivedAt
      ? archivedOperationAccessFor(this.#db, actor, operationId)
      : operationAccessFor(this.#db, actor, operationId);
    if (!access) throw notFound();
    return row;
  }

  /** Archived operations, newest first (Settings → Operations). */
  listArchived(actor: OperationActor): OperationInfo[] {
    requireManager(actor);
    const visible = accessibleArchivedOperations(this.#db, actor);
    return this.#db
      .select()
      .from(operations)
      .where(isNotNull(operations.archivedAt))
      .all()
      .sort((a, b) => (b.archivedAt?.getTime() ?? 0) - (a.archivedAt?.getTime() ?? 0))
      .flatMap((row) => {
        const access = visible.get(row.id);
        return access ? [operationInfo(this.#db, row, access)] : [];
      });
  }

  restore(actor: OperationActor, operationId: string): OperationInfo {
    const row = this.#managed(actor, operationId);
    if (!row.archivedAt) throw new AuthHttpError(409, "operation_not_archived");
    if (this.#deleting.has(operationId)) throw new AuthHttpError(409, "operation_busy");
    this.#db.transaction((tx) => {
      tx.update(operations).set({ archivedAt: null }).where(eq(operations.id, operationId)).run();
      writeAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.operationRestore,
        targetKind: "operation",
        targetId: operationId,
        meta: { name: row.name, slug: row.slug },
      });
    });
    this.#deps.onChange?.(operationId);
    const access = operationAccessFor(this.#db, actor, operationId);
    return operationInfo(this.#db, this.#row(operationId), access ?? "view");
  }

  /** "Send all home" before a delete: every henchman on the operation, branches kept. */
  async sendAllHome(
    actor: OperationActor,
    operationId: string,
  ): Promise<{ sentHome: number; failed: { agentId: string; reason: string }[] }> {
    this.#managed(actor, operationId);
    const henchmen = this.henchmen;
    if (!henchmen) throw new AuthHttpError(503, "henchmen_unavailable");
    let sentHome = 0;
    const failed: { agentId: string; reason: string }[] = [];
    for (const henchman of henchmenOn(this.#db, operationId)) {
      try {
        await henchmen.sendHome(actor, henchman.agentId);
        sentHome += 1;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "could not be sent to barracks";
        failed.push({ agentId: henchman.agentId, reason: reason.slice(0, 500) });
      }
    }
    return { sentHome, failed };
  }

  async delete(actor: OperationActor, operationId: string, confirmName: string): Promise<string[]> {
    const row = this.#managed(actor, operationId);
    if (confirmName.trim() !== row.name.trim()) {
      throw new AuthHttpError(400, "confirm_name_mismatch");
    }
    if (this.#deleting.has(operationId)) throw new AuthHttpError(409, "operation_busy");
    this.#deleting.add(operationId);
    try {
      return await this.#delete(actor, row);
    } finally {
      this.#deleting.delete(operationId);
    }
  }

  async #delete(actor: OperationActor, row: OperationRow): Promise<string[]> {
    const operationId = row.id;
    // One write transaction: a spawn admitted before it holds a desk and is
    // seen here; one after it finds the operation archived and is refused.
    const repos = this.#db.transaction(
      (tx) => {
        const henchmen = henchmenOn(tx, operationId);
        if (henchmen.length > 0)
          throw new AuthHttpError(409, "operation_has_henchmen", { henchmen });
        const list = tx
          .select()
          .from(operationRepos)
          .where(eq(operationRepos.operationId, operationId))
          .all();
        if (list.some((r) => r.cloneStatus === "cloning")) {
          throw new AuthHttpError(409, "operation_cloning");
        }
        if (!row.archivedAt) {
          tx.update(operations)
            .set({ archivedAt: new Date() })
            .where(eq(operations.id, operationId))
            .run();
          writeAudit(tx, {
            userId: actor.id,
            action: AUDIT_ACTIONS.operationArchive,
            targetKind: "operation",
            targetId: operationId,
            meta: { name: row.name, slug: row.slug, reason: "delete" },
          });
        }
        return list.map((r) => `${r.owner}/${r.name}`);
      },
      { behavior: "immediate" },
    );
    this.#deps.onChange?.(operationId);

    // A room split off a multi-repo operation shares the original's directories
    // (dirs.ts, #268): they go only with the last operation that uses them.
    const dir = operationDirName(row);
    const sharedWith = sharesDir(this.#db, row);
    let removed: string[];
    try {
      removed = sharedWith.length > 0 ? [] : await this.#deps.dirs.removeOperationDirs(dir);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.#deps.logger.error(
        { operationId, slug: row.slug, err: error },
        "operation files not removed",
      );
      writeAudit(this.#db, {
        userId: actor.id,
        action: AUDIT_ACTIONS.operationDelete,
        targetKind: "operation",
        targetId: operationId,
        meta: { name: row.name, slug: row.slug, repos, ok: false },
      });
      throw new AuthHttpError(500, "operation_files_not_removed");
    }

    this.#db.transaction((tx) => {
      tx.delete(chatMessages).where(eq(chatMessages.operationId, operationId)).run();
      // Cascades: repos, members, desks, agents (+ events, services), tasks, decor, whiteboards.
      tx.delete(operations).where(eq(operations.id, operationId)).run();
      writeAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.operationDelete,
        targetKind: "operation",
        targetId: operationId,
        meta: {
          name: row.name,
          slug: row.slug,
          repos,
          removed,
          ok: true,
          ...(sharedWith.length > 0
            ? { filesKept: dir, sharedWith: sharedWith.map((o) => o.id) }
            : {}),
        },
      });
    });
    this.#deps.onChange?.(operationId);
    this.#deps.logger.info(
      { operationId, slug: row.slug, removed, filesKeptFor: sharedWith.map((o) => o.id) },
      "operation deleted",
    );
    return removed;
  }
}
