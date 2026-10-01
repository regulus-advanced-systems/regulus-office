/**
 * Carry-a-card (SPEC §9.4; #36): a human plucks an issue or PR card from the
 * board (`card.pick`) and carries it, visible to everyone on the operation as
 * `OperationState.carriedCards[sessionId]`, then puts it down (`card.drop`).
 * Dropping it on a free desk (`seatId`) is what opens the spawn dialog,
 * prefilled, on the carrier's own screen; the spawn itself is the ordinary
 * `agent.spawn` with its own checks.
 *
 * - Picking needs `spawn` on the operation (whoever may put a henchman at a desk)
 *   and a card that is on this operation's board. One card per session: a new
 *   pick replaces the old one.
 * - A drop on a desk must name a desk seat of this operation that is free; a
 *   refused drop keeps the card in hand.
 * - Leaving the operation puts the card back.
 */
import {
  boardCardKey,
  CarriedCardSchema,
  type ClientCommand,
  COMMAND_REJECTED_MESSAGE,
  mayCarryCard,
  type OperationAccess,
} from "@regulus/protocol";
import type { RoomClient } from "../transport.ts";
import { rejection } from "./agent-commands.ts";
import type { OperationRoomState } from "./state.ts";

export type CardCommand = Extract<ClientCommand, { type: "card.pick" | "card.drop" }>;

export function isCardCommand(command: ClientCommand): command is CardCommand {
  return command.type === "card.pick" || command.type === "card.drop";
}

export interface CardContext {
  state: OperationRoomState;
  client: RoomClient;
  /** The client's access to this operation (null: none). */
  access: OperationAccess | null;
  now?: () => number;
}

export function handleCardCommand(ctx: CardContext, command: CardCommand): void {
  const { state, client } = ctx;
  const reject = (reason: string) =>
    client.send(COMMAND_REJECTED_MESSAGE, rejection(command.type, reason));

  if (command.type === "card.pick") {
    if (!mayCarryCard(ctx.access)) return reject("you may not spawn henchmen in this operation");
    const key = boardCardKey(command.repoId, command.number);
    const onBoard = command.cardKind === "pr" ? state.pulls.has(key) : state.issues.has(key);
    if (!onBoard) return reject("that card is not on this operation's board");
    const carried = new CarriedCardSchema();
    carried.sessionId = client.sessionId;
    carried.userId = client.user.userId;
    carried.cardKind = command.cardKind;
    carried.repoId = command.repoId;
    carried.number = command.number;
    carried.pickedAt = (ctx.now ?? Date.now)();
    state.carriedCards.set(client.sessionId, carried);
    return;
  }

  if (!state.carriedCards.has(client.sessionId)) return reject("you are not carrying a card");
  if (command.seatId !== undefined) {
    const desk = state.desks.get(command.seatId);
    if (!desk) return reject("no such desk in this operation");
    if (desk.agentId !== "") return reject("that desk is taken");
  }
  state.carriedCards.delete(client.sessionId);
}

/** The carrier left the operation: the card goes back on the board. */
export function dropCarriedOnLeave(state: OperationRoomState, sessionId: string): void {
  if (state.carriedCards.has(sessionId)) state.carriedCards.delete(sessionId);
}
