/**
 * What an office tool runs with (#271): the calling agent, the stores, and
 * the office's own services as narrow ports (wired in setup.ts), so the tools
 * call into the queue, the boards, the henchmen and the chat instead of
 * reimplementing them, and those services' own checks stay in force.
 */
import type {
  CardKind,
  MyUsage,
  OfficeToolError,
  OperationAccess,
  QueueSettings,
  QueueTask,
  UsageSummary,
} from "@regulus/protocol";
import type { SpawnInput } from "../../agents/manager/spawn.ts";
import type { OperationBoard } from "../../github/board-summary.ts";
import type { OperationActor } from "../../operations/access.ts";
import type { EnqueueInput } from "../../queue/index.ts";
import { type AgentAccess, type AgentPerson, accessAtLeast } from "../access.ts";
import type { Conversations } from "../conversations.ts";
import type { AgentMind } from "../mind/mind.ts";
import type { HumanRequests } from "../requests.ts";
import type { RoomScopes } from "../scope.ts";
import type { OfficeAgentRow, OfficeAgentStore } from "../store.ts";
import { type Asking, roomAccess } from "./asking.ts";

/** A refusal or failure with a message that is safe to hand to the agent. */
export class ToolError extends Error {
  override name = "ToolError";
  constructor(
    readonly code: OfficeToolError,
    message: string,
  ) {
    super(message);
  }
}

export interface CommentTarget {
  operationId: string;
  repoId: string;
  kind: CardKind;
  number: number;
}

/** The office services the tools call. Each keeps its own authorisation. */
export interface OfficePorts {
  board(operationId: string): OperationBoard;
  queue(operationId: string): { tasks: QueueTask[]; settings: QueueSettings };
  /** `TaskQueue.enqueueTask`: checks the actor's access again and that the profile is theirs. */
  enqueue(actor: OperationActor, input: EnqueueInput): { id: string };
  myUsage(userId: string): MyUsage;
  /** `henchmanRooms`: the room of each leaderboard henchman, for filtering only (#270). */
  officeUsage(): UsageSummary & { henchmanRooms?: Record<string, string> };
  /** Posts with the office's GitHub credential for that repo. */
  comment(target: CommentTarget, body: string): Promise<{ id: number; url: string }>;
  postChat(line: { userId: string; displayName: string; operationId: string; text: string }): void;
  /** `AgentManager.spawn`: the normal spawn admission, as the actor. */
  spawn(actor: OperationActor, input: SpawnInput): Promise<{ agentId: string }>;
  /** `AgentManager.stop`: only a henchman's owner may stop it. */
  stop(actor: OperationActor, henchmanId: string): Promise<void>;
}

export interface ToolDeps {
  store: OfficeAgentStore;
  access: AgentAccess;
  conversations: Conversations;
  requests: HumanRequests;
  /** The agent's soul, memories and notes (#136). */
  mind: AgentMind;
  /** What rooms a conversation has read, and who may be shown what (#301). */
  scopes: RoomScopes;
  ports: OfficePorts;
  now: () => number;
}

/** One call's context. `actedFor` is set once a person's rights were used. */
export interface ToolCall extends ToolDeps {
  agent: OfficeAgentRow;
  /** Who a shared agent's call is answered for (#301, asking.ts). */
  asking: Asking;
  /** The rooms this call handed the agent something of. */
  saw: Set<string>;
  actedFor?: string;
  /** Extra facts for the call's audit row: ids, kinds and sizes. Never text. */
  auditMeta?: Record<string, string | number | boolean>;
}

/**
 * The person a call that needs a person's rights is made as.
 *
 * - Personal agent: its owner, always; naming anyone else is refused.
 * - Shared agent: the person named in `onBehalfOf`, and only while that
 *   person is waiting for the agent's answer (an open turn in their
 *   conversation), so the agent cannot borrow someone's rights unasked. While
 *   it works on one person's message it acts for that person only (#301).
 */
export function actingPerson(call: ToolCall, onBehalfOf: string | undefined): AgentPerson {
  const { agent } = call;
  if (agent.ownerUserId !== null) {
    const owner = call.access.owner(agent);
    if (!owner) throw new ToolError("forbidden", "this agent's owner is no longer in the office");
    if (onBehalfOf !== undefined && onBehalfOf !== owner.id) {
      throw new ToolError("forbidden", "a personal agent acts only for its owner");
    }
    call.actedFor = owner.id;
    return owner;
  }
  if (!onBehalfOf) {
    throw new ToolError(
      "on_behalf_required",
      "a shared agent does this for a person: pass onBehalfOf with the id of the person who asked",
    );
  }
  // With a turn's token it acts for the person whose turn it is, and nobody else.
  if (call.asking.turn !== undefined && call.asking.turn !== onBehalfOf) {
    throw new ToolError(
      "not_waiting",
      "you are answering someone else right now, so you cannot act for that person",
    );
  }
  const person = call.store.person(onBehalfOf);
  if (!person || !call.conversations.waiting(agent.id, onBehalfOf)) {
    throw new ToolError(
      "not_waiting",
      "that person is not waiting for your answer, so you cannot act for them",
    );
  }
  call.actedFor = person.id;
  return person;
}

/**
 * The call's access to an operation, at least `needed`. An operation the
 * agent cannot see, or the person it is answering cannot see (#301), answers
 * like one that does not exist: the same words, nothing of the room.
 */
export function requireOperation(
  call: ToolCall,
  operationId: string,
  needed: OperationAccess,
  forPerson?: AgentPerson,
): OperationAccess {
  const access = roomAccess(call, operationId, forPerson);
  if (!access) throw new ToolError("not_found", "no such operation");
  if (!accessAtLeast(access, needed)) {
    throw new ToolError("forbidden", `this needs ${needed} access to the operation`);
  }
  return access;
}
