/**
 * One agent's mind as its engine reaches it (#136): `EngineMind` over the
 * office's copy. Bound to the agent's id when it is started, so an engine
 * cannot ask for another agent's. What an engine writes is checked like a
 * tool call (mind.ts) and audited without its text.
 *
 * A shared agent's memories and notes carry rooms (#301). Its engine is given
 * them for the person whose message it is about to answer: only what that
 * person can see themselves, and for nobody in particular only what is about
 * no room. What an engine hands back with `remember` could be about any room
 * the agent reads, so it is scoped to all of them.
 */
import { AUDIT_ACTIONS, writeAudit } from "../../auth/audit.ts";
import type { Db } from "../../db/index.ts";
import type { OperationActor } from "../../operations/access.ts";
import { type EngineMemory, type EngineMind, EngineRefusal } from "../engines/types.ts";
import type { RoomScopes, Visible } from "../scope.ts";
import { type AgentMind, MindError } from "./mind.ts";

/** What the port needs to know about a shared agent; left out for a personal one. */
export interface SharedMind {
  scopes: RoomScopes;
  person(userId: string): OperationActor | undefined;
  /** The rooms the agent is granted right now. */
  grants(): string[];
}

const unscoped = (rooms: readonly string[]) => rooms.length === 0;

export function engineMind(
  db: Db,
  mind: AgentMind,
  agentId: string,
  shared?: SharedMind,
): EngineMind {
  const audit = (meta: Record<string, unknown>) =>
    writeAudit(db, {
      userId: null,
      action: AUDIT_ACTIONS.officeAgentMemoryWrite,
      targetKind: "office_agent",
      targetId: agentId,
      meta: { via: "engine", ...meta },
    });
  const person = (userId: string | undefined) => (userId ? shared?.person(userId) : undefined);
  const visibleFor = (userId: string | undefined): Visible => {
    if (!shared) return undefined;
    const who = person(userId);
    return who ? shared.scopes.visibleTo([who]) : unscoped;
  };
  /** What the engine was given is in the agent's conversation with that person from now on. */
  const read = (userId: string | undefined, rooms: readonly string[]) => {
    const who = person(userId);
    if (shared && who && rooms.length > 0) shared.scopes.sawRooms(agentId, who.id, rooms);
  };
  return {
    soul: () => {
      try {
        return mind.soul(agentId).content;
      } catch {
        return "";
      }
    },
    entries: (kind, forUserId) => {
      const visible = visibleFor(forUserId);
      const list = (k: "memory" | "note") =>
        mind.list(agentId, k, { limit: 1000, visible }).entries;
      const all = kind ? list(kind) : [...list("memory"), ...list("note")];
      read(
        forUserId,
        all.flatMap((e) => e.rooms ?? []),
      );
      return all
        .map((e): EngineMemory => {
          const { by: _by, createdAt: _createdAt, rooms: _rooms, ...rest } = e;
          return rest;
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    digest: (forUserId) => {
      const { text, rooms } = mind.recall(agentId, visibleFor(forUserId));
      read(forUserId, rooms);
      return text;
    },
    remember: (text, source) => {
      try {
        const entry = mind.addMemory(agentId, { text, source }, "agent", shared?.grants() ?? []);
        audit({ entryId: entry.id, kind: "memory", chars: entry.text.length });
        const { by: _by, createdAt: _createdAt, rooms: _rooms, ...rest } = entry;
        return rest;
      } catch (err) {
        if (err instanceof MindError) throw new EngineRefusal(err.code, err.message);
        throw err;
      }
    },
    forget: (id) => {
      try {
        const gone = mind.remove(agentId, id);
        audit({ entryId: gone.id, kind: gone.kind, removed: true });
        return true;
      } catch (err) {
        if (err instanceof MindError) return false;
        throw err;
      }
    },
  };
}
