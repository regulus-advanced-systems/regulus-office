/**
 * The tools that change something (#271): ask a human, queue a task, comment
 * on a card, post chat, spawn and stop henchmen.
 *
 * Whatever needs a person's rights (queueing, spawning, stopping) is done as
 * `actingPerson` through the office's own services, which run their normal
 * admission as that person: the queue and the AgentManager check operation
 * access and the credential profile again. A shared agent's henchmen always
 * run on the office key (SPEC §8 rule 3, D2).
 *
 * What a shared agent passes on to somebody else (#301) is written from a
 * conversation that may have read rooms (asking.ts, `scopeOf`), so it goes
 * only where every reader can see all of those rooms. For a chat line, a
 * comment, a queued task and a henchman's prompt that is checked before the
 * tool runs (call.ts, `TOOL_REACH`); a question is checked here against the
 * person asked. The refusal says that and nothing about which room.
 */
import { mayWriteBoard, type OfficeToolInput, REACH_REFUSAL } from "@regulus/protocol";
import { and, eq, gte } from "drizzle-orm";
import { OFFICE_PROFILE_PREFIX } from "../../agents/manager/credentials.ts";
import { AgentManagerError } from "../../agents/manager/errors.ts";
import { AUDIT_ACTIONS, writeAudit } from "../../auth/audit.ts";
import { agents, auditLog, operationRepos } from "../../db/schema/index.ts";
import { officeCommentBody } from "../../github/board-actions.ts";
import { GitHubApiError } from "../../github/pulls.ts";
import { QueueError } from "../../queue/index.ts";
import { localDayStart } from "../../usage/summary.ts";
import { roomAccess, saw, scopeOf } from "./asking.ts";
import { actingPerson, requireOperation, type ToolCall, ToolError } from "./context.ts";

const shared = (call: ToolCall) => call.agent.ownerUserId === null;
const ASK_REFUSED = "that person cannot be asked from this conversation";

/** The credential profile a henchman started by this agent runs on. */
function henchmanProfile(call: ToolCall, provider: string, chosen: string | undefined) {
  return shared(call) ? `${OFFICE_PROFILE_PREFIX}${provider}` : chosen;
}

function fromManager(err: unknown): never {
  if (err instanceof AgentManagerError) {
    const code =
      err.code === "forbidden"
        ? "forbidden"
        : err.code === "not_found"
          ? "not_found"
          : err.code === "bad_request"
            ? "invalid_input"
            : err.code === "failed"
              ? "failed"
              : "unavailable";
    throw new ToolError(code, err.message);
  }
  throw err;
}

export function askHuman(call: ToolCall, input: OfficeToolInput<"ask_human">) {
  const { agent } = call;
  let forUserId: string;
  if (agent.ownerUserId !== null) {
    if (input.userId !== undefined && input.userId !== agent.ownerUserId) {
      throw new ToolError("forbidden", "a personal agent can only ask its owner");
    }
    if (!call.access.owner(agent)) {
      throw new ToolError("forbidden", "this agent's owner is no longer in the office");
    }
    forUserId = agent.ownerUserId;
  } else {
    if (!input.userId) throw new ToolError("invalid_input", "userId is required: who to ask");
    if (!call.store.person(input.userId)) throw new ToolError("not_found", "no such person");
    forUserId = input.userId;
  }
  if (input.operationId) requireOperation(call, input.operationId, "view");
  // The question must not show a person a room they cannot see (D27): the one it
  // names, and every room the conversation it comes from has read (#301).
  const rooms = [...new Set([...scopeOf(call), ...(input.operationId ? [input.operationId] : [])])];
  const person = call.store.person(forUserId);
  if (!person || !call.scopes.canSeeAll(person, rooms)) {
    // Because of the room the question itself names (which the agent's asker can see)...
    if (!person || (input.operationId && !call.scopes.canSeeAll(person, [input.operationId]))) {
      throw new ToolError("forbidden", "that person cannot see this operation");
    }
    // ...or because of what this conversation has read: said without naming a room, and to the
    // person in their chat as well.
    if (call.asking.turn) call.conversations.noticeReach(agent.id, call.asking.turn);
    throw new ToolError("forbidden", REACH_REFUSAL.replace("this cannot go there", ASK_REFUSED));
  }
  const request = call.requests.create({
    agentId: agent.id,
    forUserId,
    question: input.question,
    options: input.options ?? [],
    operationId: input.operationId,
    rooms,
  });
  if (!request) {
    throw new ToolError("cap_reached", "you already have too many open questions for that person");
  }
  return { requestId: request.id, status: request.status };
}

export function enqueueTask(call: ToolCall, input: OfficeToolInput<"enqueue_task">) {
  const person = actingPerson(call, input.onBehalfOf);
  requireOperation(call, input.operationId, "spawn", person);
  try {
    const task = call.ports.enqueue(person, {
      operationId: input.operationId,
      repoId: input.repoId,
      kind: input.kind,
      refNumber: input.refNumber,
      title: input.title,
      prompt: input.prompt,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      profileId: henchmanProfile(call, input.provider, input.profileId),
    });
    saw(call, input.operationId);
    return { taskId: task.id, queuedFor: person.id };
  } catch (err) {
    if (err instanceof QueueError) {
      const code =
        err.code === "bad_request"
          ? "invalid_input"
          : err.code === "conflict"
            ? "unavailable"
            : err.code;
      throw new ToolError(code, err.message);
    }
    throw err;
  }
}

export async function commentOnCard(call: ToolCall, input: OfficeToolInput<"comment_on_card">) {
  const access = roomAccess(call, input.operationId);
  if (!access) throw new ToolError("not_found", "no such operation");
  // The same rule as the board panel: commenting with the office credential needs `manage`.
  if (!mayWriteBoard(access)) {
    throw new ToolError("forbidden", "commenting needs manage access to the operation");
  }
  const repo = call.store.db
    .select({ id: operationRepos.id })
    .from(operationRepos)
    .where(
      and(eq(operationRepos.id, input.repoId), eq(operationRepos.operationId, input.operationId)),
    )
    .get();
  if (!repo) throw new ToolError("not_found", "no such repo on this operation");
  const owner = call.access.owner(call.agent);
  const signature = owner
    ? `${call.agent.name}, ${owner.displayName}'s office agent`
    : `${call.agent.name}, office agent`;
  if (owner) call.actedFor = owner.id;
  try {
    const comment = await call.ports.comment(
      {
        operationId: input.operationId,
        repoId: input.repoId,
        kind: input.kind,
        number: input.number,
      },
      officeCommentBody(input.body, signature),
    );
    saw(call, input.operationId);
    return { commentId: comment.id, url: comment.url };
  } catch (err) {
    if (err instanceof ToolError) throw err;
    if (err instanceof GitHubApiError) {
      throw new ToolError(
        err.status === 404 ? "not_found" : "failed",
        err.status === 404 ? "no such issue or pull request" : "GitHub refused the comment",
      );
    }
    throw err;
  }
}

/** Chat lines one agent may post per minute (people are rate limited by the room). */
export const CHAT_PER_MINUTE = 6;
const chatTimes = new Map<string, number[]>();

export function postChat(call: ToolCall, input: OfficeToolInput<"post_chat">) {
  if (input.operationId) requireOperation(call, input.operationId, "view");
  const now = call.now();
  const recent = (chatTimes.get(call.agent.id) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= CHAT_PER_MINUTE) {
    throw new ToolError("cap_reached", "you are posting too fast; wait a minute");
  }
  chatTimes.set(call.agent.id, [...recent, now]);
  call.ports.postChat({
    userId: `office-agent:${call.agent.id}`,
    displayName: call.agent.name,
    operationId: input.operationId ?? "",
    text: input.text,
  });
  return { posted: true };
}

/** Spawns in flight per agent, so concurrent calls cannot pass the daily cap together. */
const spawning = new Map<string, number>();

function spawnedToday(call: ToolCall): number {
  const dayStart = localDayStart(call.now(), new Date(call.now()).getTimezoneOffset());
  return call.store.db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, AUDIT_ACTIONS.officeAgentHenchmanSpawn),
        eq(auditLog.targetId, call.agent.id),
        gte(auditLog.createdAt, new Date(dayStart)),
      ),
    )
    .all().length;
}

export async function spawnHenchman(call: ToolCall, input: OfficeToolInput<"spawn_henchman">) {
  const person = actingPerson(call, input.onBehalfOf);
  requireOperation(call, input.operationId, "spawn", person);
  const cap = call.store.settings().managerDailySpawnCap;
  const inFlight = spawning.get(call.agent.id) ?? 0;
  if (spawnedToday(call) + inFlight >= cap) {
    throw new ToolError("cap_reached", `the daily cap of ${cap} spawned henchmen is reached`);
  }
  spawning.set(call.agent.id, inFlight + 1);
  try {
    const { agentId } = await call.ports.spawn(person, {
      operationId: input.operationId,
      repoId: input.repoId,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      profileId: henchmanProfile(call, input.provider, input.profileId),
      prompt: input.prompt,
      taskTitle: input.taskTitle,
      issueNumber: input.issueNumber,
      prNumber: input.prNumber,
      autoWorktree: true,
    });
    // Counted towards the cap from here on.
    writeAudit(call.store.db, {
      userId: person.id,
      action: AUDIT_ACTIONS.officeAgentHenchmanSpawn,
      targetKind: "office_agent",
      targetId: call.agent.id,
      meta: { henchmanId: agentId, operationId: input.operationId, provider: input.provider },
    });
    saw(call, input.operationId);
    return { henchmanId: agentId, spawnedFor: person.id };
  } catch (err) {
    return fromManager(err);
  } finally {
    const left = (spawning.get(call.agent.id) ?? 1) - 1;
    if (left <= 0) spawning.delete(call.agent.id);
    else spawning.set(call.agent.id, left);
  }
}

export async function stopHenchman(call: ToolCall, input: OfficeToolInput<"stop_henchman">) {
  const person = actingPerson(call, input.onBehalfOf);
  const henchman = call.store.db
    .select({ operationId: agents.operationId })
    .from(agents)
    .where(eq(agents.id, input.henchmanId))
    .get();
  // A henchman in an operation the agent cannot see is like one that does not exist.
  if (!henchman || !roomAccess(call, henchman.operationId, person)) {
    throw new ToolError("not_found", "no such henchman");
  }
  try {
    // Only a henchman's owner may stop it (D12): the manager checks that as `person`.
    await call.ports.stop(person, input.henchmanId);
  } catch (err) {
    return fromManager(err);
  }
  return { stopped: input.henchmanId };
}
