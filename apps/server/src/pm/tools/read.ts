/**
 * The read tools (#271). Every one that names an operation goes through
 * `requireOperation`; nothing here returns credentials, plan limits of other
 * people, or permission request details.
 */
import type { OfficeToolInput } from "@regulus/protocol";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { agents, operationRepos, operations, userProfiles } from "../../db/schema/index.ts";
import { requireOperation, type ToolCall, ToolError } from "./context.ts";

export function listOperations(call: ToolCall) {
  const open = call.access.operations(call.agent);
  if (open.length === 0) return { operations: [] };
  const ids = open.map((o) => o.operationId);
  const db = call.store.db;
  const rows = db
    .select({ id: operations.id, name: operations.name, slug: operations.slug })
    .from(operations)
    .where(and(inArray(operations.id, ids), isNull(operations.archivedAt)))
    .all();
  const repos = db
    .select({
      id: operationRepos.id,
      operationId: operationRepos.operationId,
      owner: operationRepos.owner,
      name: operationRepos.name,
      defaultBranch: operationRepos.defaultBranch,
      cloneStatus: operationRepos.cloneStatus,
    })
    .from(operationRepos)
    .where(inArray(operationRepos.operationId, ids))
    .all();
  return {
    operations: open.flatMap(({ operationId, access }) => {
      const row = rows.find((r) => r.id === operationId);
      if (!row) return [];
      return [
        {
          id: row.id,
          name: row.name,
          slug: row.slug,
          access,
          repos: repos
            .filter((r) => r.operationId === operationId)
            .map((r) => ({
              id: r.id,
              repo: `${r.owner}/${r.name}`,
              defaultBranch: r.defaultBranch,
              cloneStatus: r.cloneStatus,
            })),
        },
      ];
    }),
  };
}

export function listHenchmen(call: ToolCall, input: OfficeToolInput<"list_henchmen">) {
  requireOperation(call, input.operationId, "view");
  const rows = call.store.db
    .select({
      id: agents.id,
      repoId: agents.repoId,
      status: agents.status,
      provider: agents.provider,
      model: agents.model,
      taskTitle: agents.taskTitle,
      issueNumber: agents.issueNumber,
      prNumber: agents.prNumber,
      branch: agents.worktreeBranch,
      ownerUserId: agents.ownerUserId,
      ownerName: userProfiles.displayName,
      lastActivityAt: agents.lastActivityAt,
    })
    .from(agents)
    .leftJoin(userProfiles, eq(userProfiles.userId, agents.ownerUserId))
    .where(and(eq(agents.operationId, input.operationId), isNull(agents.exitedAt)))
    .orderBy(asc(agents.createdAt))
    .all();
  return {
    henchmen: rows.map((r) => ({
      id: r.id,
      repoId: r.repoId,
      status: r.status,
      provider: r.provider,
      model: r.model,
      taskTitle: r.taskTitle,
      ...(r.issueNumber ? { issueNumber: r.issueNumber } : {}),
      ...(r.prNumber ? { prNumber: r.prNumber } : {}),
      ...(r.branch ? { branch: r.branch } : {}),
      owner: { id: r.ownerUserId, name: r.ownerName ?? "" },
      ...(r.lastActivityAt ? { lastActivityAt: r.lastActivityAt.getTime() } : {}),
    })),
  };
}

export function readBoard(call: ToolCall, input: OfficeToolInput<"read_board">) {
  requireOperation(call, input.operationId, "view");
  return call.ports.board(input.operationId);
}

export function readQueue(call: ToolCall, input: OfficeToolInput<"read_queue">) {
  requireOperation(call, input.operationId, "view");
  return call.ports.queue(input.operationId);
}

/** A personal agent reads its owner's own usage; a shared one the office totals everyone sees. */
export function readUsage(call: ToolCall) {
  if (call.agent.ownerUserId === null) return { scope: "office", usage: call.ports.officeUsage() };
  const owner = call.access.owner(call.agent);
  if (!owner) throw new ToolError("forbidden", "this agent's owner is no longer in the office");
  return { scope: "owner", usage: call.ports.myUsage(owner.id) };
}

export function readHumanRequest(call: ToolCall, input: OfficeToolInput<"read_human_request">) {
  const request = call.requests.get(input.requestId);
  // Another agent's question is indistinguishable from a missing one.
  if (!request || request.agentId !== call.agent.id) {
    throw new ToolError("not_found", "no such request");
  }
  return {
    id: request.id,
    status: request.status,
    question: request.question,
    forUserId: request.forUserId,
    ...(request.answer !== undefined ? { answer: request.answer } : {}),
  };
}
