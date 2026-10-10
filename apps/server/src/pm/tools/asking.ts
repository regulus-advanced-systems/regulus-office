/**
 * Who a tool call is answered for, and what that lets it read (#301).
 *
 * A personal agent only ever acts as its owner, through the access gate; none
 * of this applies to it. A shared agent has rooms its admins granted, and
 * whatever it reads ends up in front of a person, so every call is answered
 * for exactly one person, and who that is comes from the credential the call
 * was made with, never from when it arrives or from what the agent says:
 *
 * - a **turn token**: the office mints one for each turn of a conversation,
 *   bound to the person whose message it is, and revokes it when the turn is
 *   over. A call made with it is answered for that person. A call that
 *   arrives after its turn ended carries a token that no longer exists and is
 *   not answered at all;
 * - an **access code** someone minted: that someone. A code minted before
 *   the office recorded who did, or by a person who has left, opens nothing;
 * - the **token of an engine run** (outside any turn): nobody. A shared agent
 *   has no errand of its own, so such a call is refused whatever it asks.
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
  /**
   * `turn`: the token of one turn of one person's conversation; `session`: the
   * token the office minted for an engine run; `api`: an access code a person minted.
   */
  kind: "turn" | "session" | "api";
  /** `api`: who minted it. */
  mintedBy: string | null;
  /** `turn`: whose turn it is. */
  forUserId: string | null;
}

export const ENGINE_CALLER: ToolCaller = { kind: "session", mintedBy: null, forUserId: null };

export interface Asking {
  /** The one person whose own access limits this call; absent for a personal agent. */
  person?: AgentPerson;
  /** Set when the call was made with that person's turn token. */
  turn?: string;
  /** True: a shared agent's call that nobody stands behind. It is refused. */
  none: boolean;
}

const OWNER: Asking = { none: false };
const NOBODY: Asking = { none: true };

export function askingOf(
  deps: Pick<ToolDeps, "store">,
  agent: OfficeAgentRow,
  caller: ToolCaller,
): Asking {
  if (agent.ownerUserId !== null) return OWNER;
  const userId = caller.kind === "turn" ? caller.forUserId : caller.mintedBy;
  if (caller.kind === "session" || !userId) return NOBODY;
  const person = deps.store.person(userId);
  if (!person) return NOBODY;
  return { person, none: false, ...(caller.kind === "turn" ? { turn: userId } : {}) };
}

const shared = (call: ToolCall) => call.agent.ownerUserId === null;

/**
 * The call's access to a live operation, or null: the agent's own (as its
 * owner, or by grant), lowered to what the person it is answered for may do
 * there themselves. `forPerson` is the person a shared agent acts for.
 */
export function roomAccess(
  call: ToolCall,
  operationId: string,
  forPerson?: AgentPerson,
): OperationAccess | null {
  if (!shared(call)) return call.access.operation(call.agent, operationId);
  const { person } = call.asking;
  if (!person) return null;
  const access = call.access.operation(call.agent, operationId, forPerson);
  return lowerAccess(access, operationAccessFor(call.store.db, person, operationId));
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
 * room the agent's conversation with the person it is answered for has read.
 */
export function scopeOf(call: ToolCall): string[] {
  const { person } = call.asking;
  if (!shared(call) || !person) return [];
  const rooms = new Set(call.saw);
  for (const room of call.scopes.seen(call.agent.id, person.id)) rooms.add(room);
  return [...rooms].sort();
}

/** Which of the agent's memories, notes and questions this call may be given. */
export function visibleIn(call: ToolCall): Visible {
  if (!shared(call)) return undefined;
  const { person } = call.asking;
  return person ? call.scopes.visibleTo([person]) : () => false;
}

/**
 * May this call put something where everyone who can enter `operationId`
 * reads it (null: the lobby, read by everyone)? What a shared agent writes
 * comes out of a conversation that may have read rooms, so only when every
 * one of those readers can see all of them. A personal agent writes as its
 * owner, like its owner would.
 */
export function mayReach(call: ToolCall, operationId: string | null): boolean {
  return !shared(call) || call.scopes.audienceCanSeeAll(operationId, scopeOf(call));
}
