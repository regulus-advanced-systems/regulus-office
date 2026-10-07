/**
 * One agent's mind as its engine reaches it (#136): `EngineMind` over the
 * office's copy. Bound to the agent's id when it is started, so an engine
 * cannot ask for another agent's. What an engine writes is checked like a
 * tool call (mind.ts) and audited without its text.
 */
import { AUDIT_ACTIONS, writeAudit } from "../../auth/audit.ts";
import type { Db } from "../../db/index.ts";
import { type EngineMemory, type EngineMind, EngineRefusal } from "../engines/types.ts";
import { type AgentMind, MindError } from "./mind.ts";

export function engineMind(db: Db, mind: AgentMind, agentId: string): EngineMind {
  const audit = (meta: Record<string, unknown>) =>
    writeAudit(db, {
      userId: null,
      action: AUDIT_ACTIONS.officeAgentMemoryWrite,
      targetKind: "office_agent",
      targetId: agentId,
      meta: { via: "engine", ...meta },
    });
  return {
    soul: () => {
      try {
        return mind.soul(agentId).content;
      } catch {
        return "";
      }
    },
    entries: (kind) => {
      const list = (k: "memory" | "note") => mind.list(agentId, k, { limit: 1000 }).entries;
      const all = kind ? list(kind) : [...list("memory"), ...list("note")];
      return all
        .map((e): EngineMemory => {
          const { by: _by, createdAt: _createdAt, ...rest } = e;
          return rest;
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    digest: () => mind.digest(agentId),
    remember: (text, source) => {
      try {
        const entry = mind.addMemory(agentId, { text, source }, "agent");
        audit({ entryId: entry.id, kind: "memory", chars: entry.text.length });
        const { by: _by, createdAt: _createdAt, ...rest } = entry;
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
