/**
 * "Ask a human" as the person asked sees it (#271): their open questions, and
 * answering one. Called by service.ts.
 *
 * A question carries the rooms it may be about (#301): the room it names and,
 * for a shared agent, every room the conversation it came from had read. It
 * is listed and answered only while the person can see all of them; otherwise
 * it behaves like a question that does not exist, and its words are not
 * handed back.
 */
import { type HumanRequest, mayTalkToOfficeAgent } from "@regulus/protocol";
import { AUDIT_ACTIONS, writeAudit } from "../auth/audit.ts";
import { AuthHttpError } from "../auth/errors.ts";
import type { OperationActor } from "../operations/access.ts";
import type { HumanRequests } from "./requests.ts";
import type { AgentRuntime } from "./runtime.ts";
import type { RoomScopes } from "./scope.ts";
import type { OfficeAgentStore } from "./store.ts";

export interface HumanAnswersDeps {
  store: OfficeAgentStore;
  requests: HumanRequests;
  scopes: RoomScopes;
  runtime: Pick<AgentRuntime, "deliver">;
}

/** The actor's own pending questions, about rooms they can still see (#270, #301). */
export function pendingRequestsFor(deps: HumanAnswersDeps, actor: OperationActor): HumanRequest[] {
  const { requests, scopes } = deps;
  const visible = scopes.visibleTo([actor]);
  return requests.pendingFor(actor.id).filter((r) => visible(requests.roomsOf(r.id)));
}

export async function answerRequest(
  deps: HumanAnswersDeps,
  actor: OperationActor,
  requestId: string,
  answer: string,
): Promise<HumanRequest> {
  const { requests, store, runtime, scopes } = deps;
  const request = requests.get(requestId);
  // Someone else's question is indistinguishable from a missing one, and so is one
  // about a room the person can no longer see.
  const rooms = request ? requests.roomsOf(request.id) : [];
  if (!request || request.forUserId !== actor.id || !scopes.canSeeAll(actor, rooms)) {
    throw new AuthHttpError(404, "not_found");
  }
  const answered = requests.answer(requestId, answer);
  if (!answered) throw new AuthHttpError(409, "already_answered");
  writeAudit(store.db, {
    userId: actor.id,
    action: AUDIT_ACTIONS.officeAgentRequestAnswer,
    targetKind: "office_agent",
    targetId: request.agentId,
    meta: { requestId },
  });
  // The answer also reaches the agent as the person's next message, which opens their turn.
  const row = store.get(request.agentId);
  const person = store.person(actor.id);
  // Only for someone who may talk to it: a viewer's answer is recorded, not delivered as a message.
  if (row && person && mayTalkToOfficeAgent(actor, row)) {
    const text = `[Answer to your question "${request.question.slice(0, 200)}" (request ${request.id})]\n${answer}`;
    await runtime.deliver(row, person, text).catch(() => {});
    // The question came back with the answer: its rooms are in this person's conversation
    // now. (After the delivery, which may have started their conversation over.)
    if (row.ownerUserId === null) scopes.sawRooms(row.id, actor.id, rooms);
  }
  return answered;
}
