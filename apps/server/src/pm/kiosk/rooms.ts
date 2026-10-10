/**
 * What happens to board helpers when something they depend on changes (#56):
 *
 * - their room is archived: a running helper is stopped. It stays placed, and
 *   hidden from everyone like the room; restored, it is there again and starts
 *   with the next message;
 * - their room is deleted: the helper is stopped and removed with it, with its
 *   conversations, soul and tokens. No card with the room's name is left;
 * - the office PM is removed, replaced, or run differently: helpers that run
 *   like the PM are stopped, so none keeps the old key and model; each starts
 *   again with the next message, on what is current then;
 * - at boot: a helper without a placement cannot stand anywhere. The migration
 *   turned the old label-only ones into `custom`, so any left is a remainder
 *   of a room that went another way, and is removed.
 *
 * The operations code calls the first two (wired at boot, index.ts); the
 * office agent service calls the third.
 */
import { eq } from "drizzle-orm";
import { AUDIT_ACTIONS, writeAudit } from "../../auth/audit.ts";
import { officeAgentKiosks, officeAgents } from "../../db/schema/index.ts";
import type { Logger } from "../../logging.ts";
import type { AgentRuntime } from "../runtime.ts";
import type { OfficeAgentRow, OfficeAgentStore } from "../store.ts";
import { kioskOf } from "./placements.ts";

export interface KioskRoomsDeps {
  store: OfficeAgentStore;
  runtime: Pick<AgentRuntime, "stop" | "isRunning">;
  logger: Logger;
  /** The agent list changed: the world re-reads it. */
  changed(): void;
}

export class KioskRooms {
  constructor(private readonly deps: KioskRoomsDeps) {}

  /** The helpers placed in a room. */
  #in(operationId: string): OfficeAgentRow[] {
    return this.deps.store.db
      .select({ agent: officeAgents })
      .from(officeAgentKiosks)
      .innerJoin(officeAgents, eq(officeAgents.id, officeAgentKiosks.agentId))
      .where(eq(officeAgentKiosks.operationId, operationId))
      .all()
      .map((r) => r.agent);
  }

  async #stop(row: OfficeAgentRow, reason: string): Promise<void> {
    try {
      await this.deps.runtime.stop(row.id, row.engine, reason);
    } catch (err) {
      this.deps.logger.warn(
        { agentId: row.id, err: String(err).slice(0, 200) },
        "helper not stopped",
      );
    }
  }

  #remove(row: OfficeAgentRow, operationId: string | null): void {
    this.deps.store.delete(row.id);
    writeAudit(this.deps.store.db, {
      userId: null,
      action: AUDIT_ACTIONS.officeAgentDelete,
      targetKind: "office_agent",
      targetId: row.id,
      // Not its name: a helper is named after its room.
      meta: {
        shared: true,
        role: "kiosk",
        reason: "room_removed",
        ...(operationId ? { operationId } : {}),
      },
    });
  }

  /** The room was archived. */
  async roomArchived(operationId: string): Promise<void> {
    for (const row of this.#in(operationId)) await this.#stop(row, "its room was archived");
    this.deps.changed();
  }

  /** The room is being deleted: call before its row goes. */
  async roomDeleted(operationId: string): Promise<void> {
    for (const row of this.#in(operationId)) {
      await this.#stop(row, "its room was removed");
      this.#remove(row, operationId);
    }
    this.deps.changed();
  }

  /** The office PM changed: helpers that run like it start anew on what is current. */
  async pmChanged(): Promise<void> {
    const rows = this.deps.store.db
      .select({ agent: officeAgents })
      .from(officeAgentKiosks)
      .innerJoin(officeAgents, eq(officeAgents.id, officeAgentKiosks.agentId))
      .where(eq(officeAgentKiosks.viaPm, true))
      .all();
    for (const { agent } of rows) {
      if (this.deps.runtime.isRunning(agent.id)) {
        await this.#stop(agent, "the office's project manager changed");
      }
    }
  }

  /** At boot, after the migrations: helpers without a placement go. Returns how many. */
  sweep(): number {
    const { store } = this.deps;
    const orphans = store
      .list()
      .filter((row) => row.role === "kiosk" && kioskOf(store.db, row.id) === undefined);
    for (const row of orphans) this.#remove(row, null);
    if (orphans.length > 0) this.deps.changed();
    return orphans.length;
  }
}
