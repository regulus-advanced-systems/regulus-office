/**
 * What people do with an agent's soul, memories and notes (#136), and the
 * one place that decides who may (D20 as changed on 2026-10-07):
 *
 * - a personal agent's: only the person it belongs to. An office owner or
 *   admin gets `403 not_your_agent` on every read and write here, and
 *   nothing else in the office hands them the text (see the PR for the list
 *   of paths); anyone else gets `404`, as for an agent that does not exist;
 * - a shared agent's: office owners and admins.
 *
 * Every change is audited with who, which version or entry and how big it
 * was (lines added and removed, characters). The audit never holds the text,
 * for personal and shared agents alike.
 */
import {
  type MindEntriesResponse,
  type MindEntry,
  type MindEntryKind,
  mayReadOfficeAgentMind,
  maySeeOfficeAgent,
  type OfficeAgentSoul,
  type SoulVersion,
  type SoulVersionSummary,
} from "@regulus/protocol";
import { AUDIT_ACTIONS, type AuditAction, writeAudit } from "../../auth/audit.ts";
import { AuthHttpError, forbidden } from "../../auth/errors.ts";
import type { OperationActor } from "../../operations/access.ts";
import type { AgentRuntime } from "../runtime.ts";
import type { OfficeAgentRow, OfficeAgentStore } from "../store.ts";
import { type AgentMind, assertNoSecret, MindError, type SoulSaved } from "./mind.ts";

const STATUS: Readonly<Record<MindError["code"], number>> = {
  secret_rejected: 422,
  cap_reached: 409,
  not_found: 404,
  soul_changed: 409,
  too_large: 400,
  title_taken: 409,
};

/** A refusal from the mind as an HTTP error; the message never quotes the text. */
export function mindHttpError(err: unknown): unknown {
  return err instanceof MindError
    ? new AuthHttpError(STATUS[err.code], err.code, { message: err.message })
    : err;
}

export interface MindServiceDeps {
  store: OfficeAgentStore;
  mind: AgentMind;
  runtime: Pick<AgentRuntime, "isRunning" | "stop">;
}

export class MindService {
  constructor(private readonly deps: MindServiceDeps) {}

  /** The agent, when the actor may read and change its soul, memories and notes. */
  #readable(actor: OperationActor, agentId: string): OfficeAgentRow {
    const row = this.deps.store.get(agentId);
    if (!row || !maySeeOfficeAgent(actor, row)) throw new AuthHttpError(404, "not_found");
    if (!mayReadOfficeAgentMind(actor, row)) {
      throw forbidden(row.ownerUserId === null ? "owner_or_admin_required" : "not_your_agent");
    }
    return row;
  }

  #audit(actor: OperationActor, action: AuditAction, row: OfficeAgentRow, meta: object): void {
    writeAudit(this.deps.store.db, {
      userId: actor.id,
      action,
      targetKind: "office_agent",
      targetId: row.id,
      meta: { shared: row.ownerUserId === null, ...meta },
    });
  }

  #try<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      throw mindHttpError(err);
    }
  }

  // ---- Soul ----------------------------------------------------------------------

  soul(actor: OperationActor, agentId: string): OfficeAgentSoul {
    const row = this.#readable(actor, agentId);
    return this.#try(() => this.deps.mind.soul(row.id));
  }

  versions(actor: OperationActor, agentId: string): SoulVersionSummary[] {
    const row = this.#readable(actor, agentId);
    return this.deps.mind.versions(row.id);
  }

  version(actor: OperationActor, agentId: string, version: number): SoulVersion {
    const row = this.#readable(actor, agentId);
    return this.#try(() => this.deps.mind.version(row.id, version));
  }

  /** Refuse text that may not be stored, before anything is written (creating an agent). */
  checkText(content: string): void {
    this.#try(() => assertNoSecret("This text", content));
  }

  async saveSoul(
    actor: OperationActor,
    agentId: string,
    input: { content: string; baseVersion?: number },
    kind: "edit" | "created" = "edit",
  ): Promise<OfficeAgentSoul> {
    const row = this.#readable(actor, agentId);
    const saved = this.#try(() =>
      this.deps.mind.saveSoul(row.id, input.content, {
        userId: actor.id,
        kind,
        baseVersion: input.baseVersion,
      }),
    );
    await this.#afterSoul(actor, row, saved, AUDIT_ACTIONS.officeAgentSoulSave, {});
    return saved.soul;
  }

  async revertSoul(
    actor: OperationActor,
    agentId: string,
    version: number,
  ): Promise<OfficeAgentSoul> {
    const row = this.#readable(actor, agentId);
    const saved = this.#try(() => this.deps.mind.revertSoul(row.id, version, actor.id));
    await this.#afterSoul(actor, row, saved, AUDIT_ACTIONS.officeAgentSoulRevert, {
      revertOf: version,
    });
    return saved.soul;
  }

  /** Audit a saved soul, and stop a running agent: it was started with the old one. */
  async #afterSoul(
    actor: OperationActor,
    row: OfficeAgentRow,
    saved: SoulSaved,
    action: AuditAction,
    meta: object,
  ): Promise<void> {
    if (!saved.changed) return;
    this.#audit(actor, action, row, {
      version: saved.soul.version,
      linesAdded: saved.added,
      linesRemoved: saved.removed,
      chars: saved.soul.content.length,
      ...meta,
    });
    if (this.deps.runtime.isRunning(row.id)) {
      await this.deps.runtime.stop(row.id, row.engine, "who it is was changed");
    }
  }

  // ---- Memories and notes ----------------------------------------------------------

  entries(
    actor: OperationActor,
    agentId: string,
    kind: MindEntryKind,
    query?: string,
  ): MindEntriesResponse {
    const row = this.#readable(actor, agentId);
    return this.deps.mind.list(row.id, kind, { query: query || undefined });
  }

  addEntry(
    actor: OperationActor,
    agentId: string,
    input:
      | { kind: "memory"; text: string; source?: string }
      | { kind: "note"; title: string; text: string },
  ): MindEntry {
    const row = this.#readable(actor, agentId);
    const entry = this.#try(() => {
      if (input.kind === "memory") return this.deps.mind.addMemory(row.id, input, "person");
      // In Settings a note is added, not overwritten: a taken title is said so.
      try {
        this.deps.mind.note(row.id, input.title);
      } catch {
        return this.deps.mind.writeNote(row.id, input, "person").entry;
      }
      throw new MindError("title_taken", "another note already has that title");
    });
    this.#audit(actor, AUDIT_ACTIONS.officeAgentMemoryWrite, row, {
      entryId: entry.id,
      kind: entry.kind,
      chars: entry.text.length,
      created: true,
    });
    return entry;
  }

  updateEntry(
    actor: OperationActor,
    agentId: string,
    entryId: string,
    patch: { title?: string; text?: string },
  ): MindEntry {
    const row = this.#readable(actor, agentId);
    const entry = this.#try(() => this.deps.mind.update(row.id, entryId, patch));
    this.#audit(actor, AUDIT_ACTIONS.officeAgentMemoryWrite, row, {
      entryId: entry.id,
      kind: entry.kind,
      chars: entry.text.length,
      created: false,
    });
    return entry;
  }

  removeEntry(actor: OperationActor, agentId: string, entryId: string): void {
    const row = this.#readable(actor, agentId);
    const gone = this.#try(() => this.deps.mind.remove(row.id, entryId));
    this.#audit(actor, AUDIT_ACTIONS.officeAgentMemoryDelete, row, {
      entryId: gone.id,
      kind: gone.kind,
    });
  }
}
