/**
 * The admin's henchman skin rules (#184, SPEC §5 `skin_rules`): CRUD on the
 * table, and the resolved skin of a henchman from the cached rule list
 * (protocol `resolveSkin`). Listeners hear about every change so the
 * OperationRooms can republish the skins of the henchmen they show.
 */
import {
  type CreateSkinRule,
  type HenchmanSkinId,
  isHenchmanSkinId,
  parseSkinMatch,
  rankSkinRules,
  resolveSkin,
  type SkinRule,
  type SkinSubject,
  type UpdateSkinRule,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { skinRules } from "../db/schema/index.ts";

/** Upper bound on rules, so a list stays small enough to resolve on every henchman change. */
export const MAX_SKIN_RULES = 200;

export class SkinRuleError extends Error {
  constructor(readonly code: "not_found" | "too_many_rules") {
    super(code);
  }
}

type Row = typeof skinRules.$inferSelect;

function toRule(row: Row): SkinRule | null {
  if (!parseSkinMatch(row.match) || !isHenchmanSkinId(row.skinId)) return null;
  return {
    id: row.id,
    match: row.match,
    skinId: row.skinId,
    priority: row.priority,
    createdAt: row.createdAt.getTime(),
  };
}

export class SkinRuleStore {
  private cache: SkinRule[] | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly db: Db) {}

  /** Every valid rule, best first (rows that no longer parse are skipped). */
  list(): SkinRule[] {
    if (!this.cache) {
      const rows = this.db.select().from(skinRules).all();
      this.cache = rankSkinRules(rows.map(toRule).filter((r): r is SkinRule => r !== null));
    }
    return this.cache;
  }

  get(id: string): SkinRule | undefined {
    return this.list().find((r) => r.id === id);
  }

  /** The skin a henchman wears under the current rules. */
  skinFor(subject: SkinSubject): HenchmanSkinId {
    return resolveSkin(this.list(), subject);
  }

  create(input: CreateSkinRule, createdBy: string | null): SkinRule {
    const count = this.db.select({ id: skinRules.id }).from(skinRules).all().length;
    if (count >= MAX_SKIN_RULES) throw new SkinRuleError("too_many_rules");
    const row = this.db
      .insert(skinRules)
      .values({ match: input.match, skinId: input.skinId, priority: input.priority, createdBy })
      .returning()
      .get();
    this.changed();
    const rule = toRule(row);
    if (!rule) throw new Error("skin rule did not round-trip");
    return rule;
  }

  update(id: string, patch: UpdateSkinRule): SkinRule {
    const row = this.db.update(skinRules).set(patch).where(eq(skinRules.id, id)).returning().get();
    if (!row) throw new SkinRuleError("not_found");
    this.changed();
    const rule = toRule(row);
    if (!rule) throw new Error("skin rule did not round-trip");
    return rule;
  }

  delete(id: string): boolean {
    const gone = this.db.delete(skinRules).where(eq(skinRules.id, id)).returning().all();
    if (gone.length === 0) return false;
    this.changed();
    return true;
  }

  /** Called after every change; returns an unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.cache = null;
    for (const listener of this.listeners) listener();
  }
}
