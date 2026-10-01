/**
 * Carry-a-card (SPEC §9.4; #36), client side. `card.pick` puts the card in
 * the human's hands (the OperationRoom shows it to everyone on the operation);
 * `card.drop` puts it down. Dropping it on a free desk opens the spawn
 * dialog there, prefilled from the card. The server re-checks access, the
 * card and the desk.
 */
import {
  boardCardKey,
  type CardKind,
  type CarriedCard,
  type ClientCommandPayload,
  type OperationState,
} from "@regulus/protocol";
import { useShallow } from "zustand/react/shallow";
import { getOfficeClient } from "../../net/index.ts";
import { useOperationStore } from "../../state/operation.ts";
import { useSessionStore } from "../../state/session.ts";
import type { SpawnPrefill } from "../../state/spawn.ts";

const MAX_TITLE = 200;

export interface CarriedView {
  kind: CardKind;
  repoId: string;
  number: number;
  title: string;
  /** `owner/name`, or "" when the repo is unknown. */
  repo: string;
  url: string;
  headBranch: string;
}

/** The card this user carries on this operation (any of their tabs), or null. */
export function myCarried(state: OperationState | null, userId: string | null): CarriedCard | null {
  if (!state || !userId) return null;
  return Object.values(state.carriedCards).find((c) => c.userId === userId) ?? null;
}

/** What the board knows about a carried card (it may have left the board since). */
export function carriedView(state: OperationState, card: CarriedCard): CarriedView {
  const key = boardCardKey(card.repoId, card.number);
  const onBoard = card.cardKind === "pr" ? state.pulls[key] : state.issues[key];
  const repo = state.repos.find((r) => r.repoId === card.repoId);
  return {
    kind: card.cardKind,
    repoId: card.repoId,
    number: card.number,
    title: onBoard?.title ?? "",
    repo: repo ? `${repo.owner}/${repo.name}` : "",
    url: onBoard?.url ?? "",
    headBranch: state.pulls[key]?.headBranch ?? "",
  };
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Spawn dialog fields for a card dropped on a desk. */
export function carriedPrefill(card: CarriedView): SpawnPrefill {
  const where = card.repo ? ` in ${card.repo}` : "";
  const link = card.url ? `\n\n${card.url}` : "";
  if (card.kind === "issue") {
    return {
      repoId: card.repoId,
      issueNumber: card.number,
      taskTitle: clip(`#${card.number} ${card.title}`.trim(), MAX_TITLE),
      prompt: `Work on issue #${card.number}${where}: ${card.title}${link}`,
    };
  }
  const branch = card.headBranch ? ` (branch ${card.headBranch})` : "";
  return {
    repoId: card.repoId,
    taskTitle: clip(`PR #${card.number} ${card.title}`.trim(), MAX_TITLE),
    prompt: `Pick up pull request #${card.number}${branch}${where}: ${card.title}${link}`,
  };
}

type Send = <T extends "card.pick" | "card.drop">(
  type: T,
  payload: ClientCommandPayload<T>,
) => void;
const officeSend: Send = (type, payload) => getOfficeClient().send(type, payload);

/** Pluck a card; false when the operation room is not joined. */
export function pickCard(
  card: { kind: CardKind; repoId: string; number: number },
  send: Send = officeSend,
): boolean {
  try {
    send("card.pick", { cardKind: card.kind, repoId: card.repoId, number: card.number });
    return true;
  } catch {
    return false;
  }
}

/** Put the carried card down, on a desk (`seatId`) or back on the board. */
export function dropCard(seatId?: string, send: Send = officeSend): void {
  try {
    send("card.drop", seatId ? { seatId } : {});
  } catch {
    // Not on an operation any more: the server already put it back when we left.
  }
}

/** The card the signed-in user carries here, with its board details. */
export function useMyCarried(): CarriedView | null {
  const userId = useSessionStore((s) => s.user?.id ?? null);
  return useOperationStore(
    useShallow((s) => {
      const card = myCarried(s.state, userId);
      return card && s.state ? carriedView(s.state, card) : null;
    }),
  );
}
