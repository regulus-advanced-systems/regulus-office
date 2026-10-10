/**
 * The brief of a board helper, for one person (SPEC §10 M5; #56):
 *
 *   GET /api/office-agents/:id/brief
 *
 * Answered only for someone who sees the helper, which means someone whose own
 * GitHub access opens its room (`seesAgent`); for everyone else, and for an
 * agent that is not a placed board helper, it is 404, like an agent that does
 * not exist. The helper's own access to the room is asked too: a helper that
 * was let out of its room has nothing to say.
 */
import {
  agentAllowsTool,
  type KioskBrief,
  mayTalkToOfficeAgent,
  OFFICE_AGENTS_API_PATH,
} from "@regulus/protocol";
import { and, eq, isNull } from "drizzle-orm";
import { AuthHttpError } from "../../auth/errors.ts";
import { agents } from "../../db/schema/index.ts";
import { json, type Router } from "../../http/router.ts";
import { type OperationActor, operationAccessFor } from "../../operations/access.ts";
import { type AgentAccess, accessAtLeast, lowerAccess } from "../access.ts";
import type { PersonHandler } from "../routes.ts";
import type { OfficeAgentStore } from "../store.ts";
import type { OfficePorts } from "../tools/context.ts";
import { buildBrief } from "./brief.ts";
import { kioskOf, kioskView, seesAgent } from "./placements.ts";

export interface KioskServiceDeps {
  store: OfficeAgentStore;
  access: AgentAccess;
  ports: Pick<OfficePorts, "board" | "queue">;
  now: () => number;
}

const notFound = () => new AuthHttpError(404, "not_found");

export class KioskService {
  constructor(private readonly deps: KioskServiceDeps) {}

  brief(actor: OperationActor, agentId: string): KioskBrief {
    const { store, access, ports } = this.deps;
    const row = store.get(agentId);
    const placement = row?.role === "kiosk" ? kioskOf(store.db, agentId) : undefined;
    if (!row || !placement || !seesAgent(store.db, actor, row, placement)) throw notFound();
    const { operationId, board } = placement;
    const own = operationAccessFor(store.db, actor, operationId);
    const granted = access.operation(row, operationId);
    if (!own || !granted) throw notFound();

    const cards = ports.board(operationId);
    let queue: ReturnType<OfficePorts["queue"]> | null = null;
    if (board === "queue") {
      try {
        queue = ports.queue(operationId);
      } catch {
        // The queue is not up (boot): the brief says so.
      }
    }
    const working = { issues: new Set<string>(), pulls: new Set<string>() };
    const busy = store.db
      .select({ repoId: agents.repoId, issue: agents.issueNumber, pull: agents.prNumber })
      .from(agents)
      .where(and(eq(agents.operationId, operationId), isNull(agents.exitedAt)))
      .all();
    for (const h of busy) {
      if (h.issue) working.issues.add(`${h.repoId}#${h.issue}`);
      if (h.pull) working.pulls.add(`${h.repoId}#${h.pull}`);
    }
    const now = this.deps.now();
    const text = buildBrief(board, { ...cards, queue, working, now });
    return {
      agentId: row.id,
      operationId,
      operationName: kioskView(store, row, placement).operationName,
      board,
      ...text,
      // The same three things `enqueue_task` asks: its tools, its room access, and the person's own.
      canEnqueue:
        mayTalkToOfficeAgent(actor, row) &&
        agentAllowsTool(row, "enqueue_task") &&
        accessAtLeast(lowerAccess(granted, own), "spawn"),
      generatedAt: now,
    };
  }
}

export function mountKioskRoutes(router: Router, handle: PersonHandler, service: KioskService) {
  router.get(
    `${OFFICE_AGENTS_API_PATH}/:id/brief`,
    handle((ctx, actor) =>
      json(service.brief(actor, ctx.params.id ?? ""), { headers: { "cache-control": "no-store" } }),
    ),
  );
}
