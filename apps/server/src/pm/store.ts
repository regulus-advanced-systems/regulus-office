/**
 * Office agent rows, the operations a shared agent was granted, and the
 * office's caps (#271). No authorisation here: service.ts and access.ts decide
 * who may call what.
 *
 * An agent's `instructions` (its soul as it is now) are encrypted in the row
 * (#301, mind/seal.ts): rows leave this store with the text opened, and
 * nothing but this store and mind/store.ts writes that column.
 */
import {
  DEFAULT_OFFICE_AGENT_SETTINGS,
  type OfficeAgentGrant,
  type OfficeAgentSettings,
  type OfficeAgentStatus,
} from "@regulus/protocol";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "../auth/audit.ts";
import type { Db } from "../db/index.ts";
import {
  officeAgentGrants,
  officeAgentSettings,
  officeAgents,
  operations,
  userProfiles,
} from "../db/schema/index.ts";
import { type MindCipher, PLAIN, SealedUnreadable } from "./mind/seal.ts";

type StoredAgent = typeof officeAgents.$inferSelect;
/** An agent with its `instructions` opened. */
export type OfficeAgentRow = Omit<StoredAgent, "instructionsSealed">;
export type NewOfficeAgentRow = Omit<
  typeof officeAgents.$inferInsert,
  "nameKey" | "instructionsSealed"
>;
/** What `update` may change: the soul has its own writer (mind/store.ts). */
export type OfficeAgentPatch = Partial<
  Omit<typeof officeAgents.$inferInsert, "instructions" | "instructionsSealed" | "id">
>;

const SETTINGS_ID = "office";

/** Names are compared without case or repeated spaces. */
export const nameKeyOf = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export class OfficeAgentStore {
  constructor(
    readonly db: Db,
    private readonly now: () => number = Date.now,
    private readonly cipher: MindCipher = PLAIN,
  ) {}

  /**
   * A row whose document cannot be opened (the master key is missing or is
   * another one) still lists, with an empty document: its card, its body and
   * its removal must keep working. It cannot be started (`soulUnreadable`),
   * and reading the document says why (mind/mind.ts).
   */
  #open = (row: StoredAgent): OfficeAgentRow => {
    const { instructionsSealed: sealed, ...rest } = row;
    try {
      const instructions = this.cipher.open(row.id, { text: row.instructions, sealed });
      return { ...rest, instructions };
    } catch (err) {
      if (!(err instanceof SealedUnreadable)) throw err;
      return { ...rest, instructions: "" };
    }
  };

  /** True when the agent's document is encrypted under a key the office does not have. */
  soulUnreadable(id: string): boolean {
    const row = this.db
      .select({ text: officeAgents.instructions, sealed: officeAgents.instructionsSealed })
      .from(officeAgents)
      .where(eq(officeAgents.id, id))
      .get();
    if (!row) return false;
    try {
      this.cipher.open(id, row);
      return false;
    } catch (err) {
      if (err instanceof SealedUnreadable) return true;
      throw err;
    }
  }

  list(): OfficeAgentRow[] {
    return this.db
      .select()
      .from(officeAgents)
      .orderBy(asc(officeAgents.createdAt))
      .all()
      .map(this.#open);
  }

  get(id: string): OfficeAgentRow | undefined {
    const row = this.db.select().from(officeAgents).where(eq(officeAgents.id, id)).get();
    return row ? this.#open(row) : undefined;
  }

  nameTaken(name: string): boolean {
    return (
      this.db
        .select({ id: officeAgents.id })
        .from(officeAgents)
        .where(eq(officeAgents.nameKey, nameKeyOf(name)))
        .get() !== undefined
    );
  }

  /** Agents owned by a person (`null`: by the office). */
  ownedBy(ownerUserId: string | null): OfficeAgentRow[] {
    return this.db
      .select()
      .from(officeAgents)
      .where(
        ownerUserId === null
          ? isNull(officeAgents.ownerUserId)
          : eq(officeAgents.ownerUserId, ownerUserId),
      )
      .all()
      .map(this.#open);
  }

  countOwnedBy(ownerUserId: string): number {
    const row = this.db
      .select({ n: count() })
      .from(officeAgents)
      .where(eq(officeAgents.ownerUserId, ownerUserId))
      .get();
    return row?.n ?? 0;
  }

  insert(db: DbOrTx, row: NewOfficeAgentRow): OfficeAgentRow {
    // The id is chosen here: the soul's envelope is bound to it.
    const id = row.id ?? crypto.randomUUID();
    const soul = this.cipher.seal(id, row.instructions ?? "");
    const stored = db
      .insert(officeAgents)
      .values({
        ...row,
        id,
        instructions: soul.text,
        instructionsSealed: soul.sealed,
        nameKey: nameKeyOf(row.name),
      })
      .returning()
      .get();
    return this.#open(stored);
  }

  update(id: string, patch: OfficeAgentPatch): OfficeAgentRow | undefined {
    const row = this.db
      .update(officeAgents)
      .set(patch)
      .where(eq(officeAgents.id, id))
      .returning()
      .get();
    return row ? this.#open(row) : undefined;
  }

  setStatus(id: string, status: OfficeAgentStatus, reason: string | null = null): void {
    this.db
      .update(officeAgents)
      .set({ status, statusReason: reason ? reason.slice(0, 300) : null })
      .where(eq(officeAgents.id, id))
      .run();
  }

  touch(id: string): void {
    this.db
      .update(officeAgents)
      .set({ lastActivityAt: new Date(this.now()) })
      .where(eq(officeAgents.id, id))
      .run();
  }

  delete(id: string): boolean {
    return (
      this.db
        .delete(officeAgents)
        .where(eq(officeAgents.id, id))
        .returning({ id: officeAgents.id })
        .all().length > 0
    );
  }

  /** After a restart no engine run survives: every agent is stopped until started again. */
  resetStatuses(): void {
    this.db.update(officeAgents).set({ status: "stopped", statusReason: null }).run();
  }

  // ---- Grants (shared agents) --------------------------------------------------

  /** Grants on live operations only. */
  grants(agentId: string): OfficeAgentGrant[] {
    return this.db
      .select({ operationId: officeAgentGrants.operationId, access: officeAgentGrants.access })
      .from(officeAgentGrants)
      .innerJoin(operations, eq(operations.id, officeAgentGrants.operationId))
      .where(and(eq(officeAgentGrants.agentId, agentId), isNull(operations.archivedAt)))
      .orderBy(asc(officeAgentGrants.createdAt))
      .all();
  }

  grantFor(agentId: string, operationId: string): OfficeAgentGrant["access"] | null {
    return this.grants(agentId).find((g) => g.operationId === operationId)?.access ?? null;
  }

  /** Replace the agent's grants; false when one names an operation that does not exist. */
  setGrants(agentId: string, grants: readonly OfficeAgentGrant[]): boolean {
    const wanted = new Map(grants.map((g) => [g.operationId, g.access]));
    for (const operationId of wanted.keys()) {
      const found = this.db
        .select({ id: operations.id })
        .from(operations)
        .where(eq(operations.id, operationId))
        .get();
      if (!found) return false;
    }
    this.db.transaction((tx) => {
      tx.delete(officeAgentGrants).where(eq(officeAgentGrants.agentId, agentId)).run();
      for (const [operationId, access] of wanted) {
        tx.insert(officeAgentGrants).values({ agentId, operationId, access }).run();
      }
    });
    return true;
  }

  // ---- Settings ----------------------------------------------------------------

  settings(): OfficeAgentSettings {
    const row = this.db
      .select()
      .from(officeAgentSettings)
      .where(eq(officeAgentSettings.id, SETTINGS_ID))
      .get();
    return row
      ? {
          personalAgentCap: row.personalAgentCap,
          managerDailySpawnCap: row.managerDailySpawnCap,
          sharedMessagesPerHour: row.sharedMessagesPerHour,
        }
      : { ...DEFAULT_OFFICE_AGENT_SETTINGS };
  }

  saveSettings(settings: OfficeAgentSettings): void {
    this.db
      .insert(officeAgentSettings)
      .values({ id: SETTINGS_ID, ...settings })
      .onConflictDoUpdate({ target: officeAgentSettings.id, set: { ...settings } })
      .run();
  }

  // ---- People --------------------------------------------------------------------

  /** A person's office role and name right now; undefined when they are gone. */
  person(
    userId: string,
  ): { id: string; role: OfficeAgentPersonRole; displayName: string } | undefined {
    const row = this.db
      .select({ role: userProfiles.role, displayName: userProfiles.displayName })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .get();
    return row ? { id: userId, role: row.role, displayName: row.displayName } : undefined;
  }
}

type OfficeAgentPersonRole = (typeof userProfiles.$inferSelect)["role"];
