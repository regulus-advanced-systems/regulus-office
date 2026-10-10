/**
 * Task proposals of board helpers (SPEC §10 M5; #56).
 *
 * A helper reads boards and queues, which hold other people's text: issue and
 * pull request titles, labels, branch names, the prompts of tasks someone else
 * queued. Text like that can talk a model into calling a tool. So a helper's
 * `enqueue_task` queues nothing. It stores a proposal for the person whose
 * turn it is answering; that person is shown exactly what would be queued
 * (kind, issue or PR number, the prompt, provider and model) and queues it
 * themselves with a request from their own browser:
 *
 *   GET  /api/office-agents/:id/proposals                       the caller's own open ones
 *   POST /api/office-agents/:id/proposals/:proposalId/confirm   queue it, as the caller
 *   POST /api/office-agents/:id/proposals/:proposalId/dismiss
 *
 * These routes take a person's session and a same-origin request; an agent
 * token opens none of them, so no agent can confirm what it proposed. On
 * confirm everything is checked again as it is at that moment: the proposal
 * is the caller's, open and not expired, the helper still stands in that room
 * and may still queue, and the queue runs its own admission as the caller.
 * A proposal lives for `TASK_PROPOSAL_LIMITS.ttlMs`, and goes when the person
 * starts their conversation with the helper over.
 *
 * Where the text ends up (#301, `TOOL_REACH` in tools/call.ts): `enqueue_task`
 * is classified `room`, so the dispatcher has already refused the proposal
 * unless everyone who can enter the target room can see every room the
 * conversation has read. For a helper that is its own room and nothing else:
 * it reads no other (access.ts), and it proposes into no other. The proposal
 * itself is read by one person, the one it was made for, who can see that
 * room. On confirm the task's title and prompt become readable by the room,
 * so the same question is asked again then, with the conversation as it is.
 */
import {
  agentAllowsTool,
  OFFICE_AGENTS_API_PATH,
  TASK_PROPOSAL_LIMITS,
  type TaskProposal,
  TaskProposalTask,
} from "@regulus/protocol";
import { and, asc, eq, gt, lte } from "drizzle-orm";
import { OFFICE_PROFILE_PREFIX } from "../../agents/manager/credentials.ts";
import { AUDIT_ACTIONS, writeAudit } from "../../auth/audit.ts";
import { AuthHttpError } from "../../auth/errors.ts";
import type { Db } from "../../db/index.ts";
import {
  githubIssues,
  githubPulls,
  officeAgentTaskProposals,
  operationRepos,
  operations,
} from "../../db/schema/index.ts";
import { json, type RouteContext, type Router } from "../../http/router.ts";
import { type OperationActor, operationAccessFor } from "../../operations/access.ts";
import { QueueError } from "../../queue/index.ts";
import { type AgentAccess, accessAtLeast, lowerAccess } from "../access.ts";
import type { Conversations } from "../conversations.ts";
import type { PersonHandler } from "../routes.ts";
import type { RoomScopes } from "../scope.ts";
import type { OfficeAgentRow, OfficeAgentStore } from "../store.ts";
import type { OfficePorts } from "../tools/context.ts";
import { kioskOf, seesAgent } from "./placements.ts";

type Row = typeof officeAgentTaskProposals.$inferSelect;

/** The stored proposals. No authorisation here. */
export class TaskProposals {
  /** Called when a person's open proposals changed (the chat window shows them). */
  onChange: ((userId: string) => void) | undefined;

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  /** Store one for a person; with too many open already, the oldest are dropped. */
  create(agentId: string, forUserId: string, task: TaskProposalTask): Row {
    const open = this.open(agentId, forUserId);
    for (const old of open.slice(
      0,
      Math.max(0, open.length + 1 - TASK_PROPOSAL_LIMITS.openPerPerson),
    )) {
      this.close(old.id, "dismissed");
    }
    const row = this.db
      .insert(officeAgentTaskProposals)
      .values({
        agentId,
        forUserId,
        operationId: task.operationId,
        inputJson: JSON.stringify(task),
        expiresAt: new Date(this.now() + TASK_PROPOSAL_LIMITS.ttlMs),
      })
      .returning()
      .get();
    this.onChange?.(forUserId);
    return row;
  }

  /** One person's open, unexpired proposals from one helper, oldest first. */
  open(agentId: string, forUserId: string): Row[] {
    return this.db
      .select()
      .from(officeAgentTaskProposals)
      .where(
        and(
          eq(officeAgentTaskProposals.agentId, agentId),
          eq(officeAgentTaskProposals.forUserId, forUserId),
          eq(officeAgentTaskProposals.status, "pending"),
          gt(officeAgentTaskProposals.expiresAt, new Date(this.now())),
        ),
      )
      .orderBy(asc(officeAgentTaskProposals.createdAt))
      .all();
  }

  get(id: string): Row | undefined {
    return this.db
      .select()
      .from(officeAgentTaskProposals)
      .where(eq(officeAgentTaskProposals.id, id))
      .get();
  }

  expired(row: Row): boolean {
    return row.expiresAt.getTime() <= this.now();
  }

  /** Close an open proposal; false when it was not open any more (someone was first). */
  close(id: string, status: "confirmed" | "dismissed", taskId?: string): boolean {
    const done = this.db
      .update(officeAgentTaskProposals)
      .set({ status, ...(taskId ? { taskId } : {}) })
      .where(
        and(eq(officeAgentTaskProposals.id, id), eq(officeAgentTaskProposals.status, "pending")),
      )
      .returning({ userId: officeAgentTaskProposals.forUserId })
      .all();
    for (const { userId } of done) this.onChange?.(userId);
    return done.length > 0;
  }

  /** The person started the conversation over: what was proposed in it is gone with it. */
  dropOpen(agentId: string, forUserId: string): number {
    const open = this.open(agentId, forUserId);
    for (const row of open) this.close(row.id, "dismissed");
    return open.length;
  }

  /** Housekeeping: rows whose time is long over. */
  prune(): void {
    this.db
      .delete(officeAgentTaskProposals)
      .where(lte(officeAgentTaskProposals.expiresAt, new Date(this.now() - 24 * 60 * 60_000)))
      .run();
  }
}

/** The task of a stored proposal, or null when the row does not hold one. */
export function taskOf(row: Row): TaskProposalTask | null {
  try {
    const parsed = TaskProposalTask.safeParse(JSON.parse(row.inputJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface ProposalServiceDeps {
  store: OfficeAgentStore;
  access: AgentAccess;
  proposals: TaskProposals;
  conversations: Conversations;
  /** What rooms the person's conversation with the helper has read (#301). */
  scopes: Pick<RoomScopes, "seen" | "audienceCanSeeAll">;
  ports: Pick<OfficePorts, "enqueue">;
}

const notFound = () => new AuthHttpError(404, "not_found");

/** What people do with proposals: read their own, confirm one, dismiss one. */
export class ProposalService {
  constructor(private readonly deps: ProposalServiceDeps) {}

  /** The helper, when the caller sees it; like an agent that does not exist otherwise. */
  #helper(actor: OperationActor, agentId: string): OfficeAgentRow {
    const row = this.deps.store.get(agentId);
    if (!row || row.role !== "kiosk" || !seesAgent(this.deps.store.db, actor, row)) {
      throw notFound();
    }
    return row;
  }

  #view(agent: OfficeAgentRow, row: Row, task: TaskProposalTask): TaskProposal {
    const { db } = this.deps.store;
    const room = db
      .select({ name: operations.name })
      .from(operations)
      .where(eq(operations.id, task.operationId))
      .get();
    const repo = db
      .select({ owner: operationRepos.owner, name: operationRepos.name })
      .from(operationRepos)
      .where(eq(operationRepos.id, task.repoId))
      .get();
    const cards = task.kind === "pr" ? githubPulls : githubIssues;
    const card =
      task.kind !== "freeform" && task.refNumber !== undefined
        ? db
            .select({ title: cards.title })
            .from(cards)
            .where(and(eq(cards.repoId, task.repoId), eq(cards.number, task.refNumber)))
            .get()
        : undefined;
    return {
      id: row.id,
      agentId: agent.id,
      agentName: agent.name,
      operationName: room?.name ?? "",
      repo: repo ? `${repo.owner}/${repo.name}` : "",
      cardTitle: (card?.title ?? "").slice(0, 300),
      task,
      status: row.status,
      createdAt: row.createdAt.getTime(),
      expiresAt: row.expiresAt.getTime(),
    };
  }

  list(actor: OperationActor, agentId: string): TaskProposal[] {
    const agent = this.#helper(actor, agentId);
    return this.deps.proposals.open(agent.id, actor.id).flatMap((row) => {
      const task = taskOf(row);
      return task ? [this.#view(agent, row, task)] : [];
    });
  }

  /** The caller's own open proposal of this helper; anything else is "not found". */
  #own(actor: OperationActor, agent: OfficeAgentRow, proposalId: string): Row {
    const row = this.deps.proposals.get(proposalId);
    if (!row || row.agentId !== agent.id || row.forUserId !== actor.id) throw notFound();
    if (row.status !== "pending") throw new AuthHttpError(409, "proposal_closed");
    if (this.deps.proposals.expired(row)) throw new AuthHttpError(410, "proposal_expired");
    return row;
  }

  dismiss(actor: OperationActor, agentId: string, proposalId: string): void {
    const agent = this.#helper(actor, agentId);
    const row = this.#own(actor, agent, proposalId);
    this.deps.proposals.close(row.id, "dismissed");
    this.#audit(actor, AUDIT_ACTIONS.officeAgentProposalDismiss, agent, row);
  }

  /** Queue it, as the caller and with the caller's rights, on the office key. */
  confirm(actor: OperationActor, agentId: string, proposalId: string): { taskId: string } {
    const { store, access, proposals, ports, conversations, scopes } = this.deps;
    const agent = this.#helper(actor, agentId);
    const row = this.#own(actor, agent, proposalId);
    const task = taskOf(row);
    const placement = kioskOf(store.db, agent.id);
    // The helper still stands in that room and may still queue there, and so may the person.
    const reach = lowerAccess(
      access.operation(agent, row.operationId),
      operationAccessFor(store.db, actor, row.operationId),
    );
    if (
      !task ||
      placement?.operationId !== row.operationId ||
      !agentAllowsTool(agent, "enqueue_task") ||
      !accessAtLeast(reach, "spawn") ||
      // The task's words are read by the whole room from here on (#301).
      !scopes.audienceCanSeeAll(row.operationId, scopes.seen(agent.id, actor.id))
    ) {
      proposals.close(row.id, "dismissed");
      throw new AuthHttpError(409, "proposal_no_longer_allowed");
    }
    // Taken before the queue is asked, so two confirmations cannot queue it twice.
    if (!proposals.close(row.id, "confirmed")) throw new AuthHttpError(409, "proposal_closed");
    let taskId: string;
    try {
      taskId = ports.enqueue(actor, {
        ...task,
        profileId: `${OFFICE_PROFILE_PREFIX}${task.provider}`,
      }).id;
    } catch (err) {
      if (err instanceof QueueError) {
        const status = err.code === "forbidden" ? 403 : err.code === "bad_request" ? 400 : 409;
        throw new AuthHttpError(status, "proposal_refused", { message: err.message });
      }
      throw err;
    }
    store.db
      .update(officeAgentTaskProposals)
      .set({ taskId })
      .where(eq(officeAgentTaskProposals.id, row.id))
      .run();
    this.#audit(actor, AUDIT_ACTIONS.officeAgentProposalConfirm, agent, row, { taskId });
    const what =
      task.kind === "freeform"
        ? "a task"
        : `${task.kind === "pr" ? "PR" : "issue"} #${task.refNumber}`;
    conversations.append(
      agent.id,
      actor.id,
      "system",
      `You confirmed it: ${what} is on the queue.`,
    );
    return { taskId };
  }

  #audit(
    actor: OperationActor,
    action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
    agent: OfficeAgentRow,
    row: Row,
    meta: Record<string, string> = {},
  ): void {
    writeAudit(this.deps.store.db, {
      userId: actor.id,
      action,
      targetKind: "office_agent",
      targetId: agent.id,
      // Ids only: never the prompt.
      meta: { proposalId: row.id, operationId: row.operationId, ...meta },
    });
  }
}

export function mountProposalRoutes(
  router: Router,
  handle: PersonHandler,
  service: ProposalService,
) {
  const base = `${OFFICE_AGENTS_API_PATH}/:id/proposals`;
  const ids = (ctx: RouteContext) => [ctx.params.id ?? "", ctx.params.proposalId ?? ""] as const;
  router.get(
    base,
    handle((ctx, actor) =>
      json(
        { proposals: service.list(actor, ctx.params.id ?? "") },
        { headers: { "cache-control": "no-store" } },
      ),
    ),
  );
  router.post(
    `${base}/:proposalId/confirm`,
    handle((ctx, actor) => json(service.confirm(actor, ...ids(ctx))), true),
  );
  router.post(
    `${base}/:proposalId/dismiss`,
    handle((ctx, actor) => {
      service.dismiss(actor, ...ids(ctx));
      return new Response(null, { status: 204 });
    }, true),
  );
}
