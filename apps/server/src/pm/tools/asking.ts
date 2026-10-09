/**
 * Who a tool call is answered for, and what that lets it read (#301).
 *
 * A personal agent only ever acts as its owner, through the access gate; none
 * of this applies to it. A shared agent has rooms its admins granted, and
 * whatever it reads ends up in front of a person, so every call is limited by
 * the people it is answered for:
 *
 * - called by its engine while it works on a person's message: that person
 *   (the engine reports whose turn it is; engines run one turn at a time);
 * - called by its engine with no turn known: everyone who is waiting for its
 *   answer, all at once (the lowest of them decides);
 * - called with an access code someone minted: that someone. A code minted
 *   before the office recorded who did, or by a person who has left, opens no
 *   room at all;
 * - called by its engine while nobody waits: the agent is working on its own,
 *   under its grants. What it writes down then is scoped to all of them.
 *
 * The limit is the person's own access as the gate gives it at that moment
 * (`operationAccessFor`): never a role, never the agent's grant alone.
 */
import type { OperationAccess } from "@regulus/protocol";
import { operationAccessFor } from "../../operations/access.ts";
import { type AgentPerson, lowerAccess } from "../access.ts";
import type { Visible } from "../scope.ts";
import type { OfficeAgentRow } from "../store.ts";
import type { ToolCall, ToolDeps } from "./context.ts";

/** How the call was authenticated. */
export interface ToolCaller {
  /** `session`: the token the office minted for an engine run; `api`: an access code a person minted. */
  kind: "session" | "api";
  mintedBy: string | null;
}

export const ENGINE_CALLER: ToolCaller = { kind: "session", mintedBy: null };

export interface Asking {
  /** The people whose own access limits this call. */
  people: AgentPerson[];
  /** The person whose message the agent is working on, when its engine said so. */
  turn?: string;
  /** True: nobody the office knows stands behind the call, so it reads no room. */
  none: boolean;
}

const UNLIMITED: Asking = { people: [], none: false };

export function askingOf(
  deps: Pick<ToolDeps, "store" | "conversations" | "turnOf">,
  agent: OfficeAgentRow,
  caller: ToolCaller,
): Asking {
  if (agent.ownerUserId !== null) return UNLIMITED;
  const { store } = deps;
  if (caller.kind === "api") {
    const minter = caller.mintedBy ? store.person(caller.mintedBy) : undefined;
    return minter ? { people: [minter], none: false } : { people: [], none: true };
  }
  const turn = deps.turnOf(agent.id);
  if (turn !== undefined) {
    const person = store.person(turn);
    return person ? { people: [person], turn, none: false } : { people: [], turn, none: true };
  }
  const waiting = deps.conversations
    .waitingPeople(agent.id)
    .flatMap((userId) => store.person(userId) ?? []);
  return { people: waiting, none: false };
}

const shared = (call: ToolCall) => call.agent.ownerUserId === null;

/**
 * The call's access to a live operation, or null: the agent's own (as its
 * owner, or by grant), lowered to what every person it is answered for may
 * do there themselves. `forPerson` is the person a shared agent acts for.
 */
export function roomAccess(
  call: ToolCall,
  operationId: string,
  forPerson?: AgentPerson,
): OperationAccess | null {
  if (!shared(call)) return call.access.operation(call.agent, operationId);
  if (call.asking.none) return null;
  let access = call.access.operation(call.agent, operationId, forPerson);
  for (const person of call.asking.people) {
    if (!access) break;
    access = lowerAccess(access, operationAccessFor(call.store.db, person, operationId));
  }
  return access;
}

/** Every live operation open to the call, with its access. */
export function openRooms(call: ToolCall): Array<{ operationId: string; access: OperationAccess }> {
  return call.access.operations(call.agent).flatMap(({ operationId }) => {
    const access = roomAccess(call, operationId);
    return access ? [{ operationId, access }] : [];
  });
}

/** The call handed the agent something of these rooms: they are in its conversation from now on. */
export function saw(call: ToolCall, ...rooms: string[]): void {
  if (shared(call)) for (const room of rooms) call.saw.add(room);
}

/**
 * The rooms whatever this call writes down or passes on may be about: every
 * room the agent's conversations with the people it is answered for have
 * read. Working on its own, every room it is granted.
 */
export function scopeOf(call: ToolCall): string[] {
  if (!shared(call) || call.asking.none) return [];
  const rooms = new Set(call.saw);
  if (call.asking.people.length === 0) {
    for (const grant of call.store.grants(call.agent.id)) rooms.add(grant.operationId);
  }
  for (const person of call.asking.people) {
    for (const room of call.scopes.seen(call.agent.id, person.id)) rooms.add(room);
  }
  return [...rooms].sort();
}

/** Which of the agent's memories, notes and questions this call may be given. */
export function visibleIn(call: ToolCall): Visible {
  if (!shared(call)) return undefined;
  if (call.asking.none) return (rooms) => rooms.length === 0;
  if (call.asking.people.length === 0) return undefined;
  return call.scopes.visibleTo(call.asking.people);
}
