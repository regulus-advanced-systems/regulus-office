/**
 * Issue and PR board summaries in the OperationRoom state (SPEC §6 channel 2;
 * #35 publishes them, #36 draws the boards). Cards are keyed by
 * `boardCardKey(repoId, number)`; only changed fields are written, so an
 * unchanged board produces no patch.
 */
import {
  boardCardKey,
  IssueCard,
  IssueCardSchema,
  PullCard,
  PullCardSchema,
} from "@regulus/protocol";
import type { OperationRoomState } from "./state.ts";

export interface BoardCards {
  issues: IssueCard[];
  pulls: PullCard[];
}

/** Validate a board against the protocol shapes (throws on a bad card). */
export function parseBoard(board: BoardCards): BoardCards {
  return {
    issues: board.issues.map((c) => IssueCard.parse(c)),
    pulls: board.pulls.map((c) => PullCard.parse(c)),
  };
}

type IssueSchema = InstanceType<typeof IssueCardSchema>;
type PullSchema = InstanceType<typeof PullCardSchema>;

function sameList(target: { length: number; at(i: number): string | undefined }, next: string[]) {
  if (target.length !== next.length) return false;
  return next.every((v, i) => target.at(i) === v);
}

function writeCard(target: IssueSchema | PullSchema, card: IssueCard): void {
  if (target.repoId !== card.repoId) target.repoId = card.repoId;
  if (target.number !== card.number) target.number = card.number;
  if (target.title !== card.title) target.title = card.title;
  if (target.state !== card.state) target.state = card.state;
  if (!sameList(target.labels, card.labels)) {
    target.labels.clear();
    target.labels.push(...card.labels);
  }
  if (!sameList(target.assignees, card.assignees)) {
    target.assignees.clear();
    target.assignees.push(...card.assignees);
  }
  if (target.author !== card.author) target.author = card.author;
  if (target.url !== card.url) target.url = card.url;
  if (target.updatedAt !== card.updatedAt) target.updatedAt = card.updatedAt;
}

function writePull(target: PullSchema, card: PullCard): PullSchema {
  writeCard(target, card);
  if (target.draft !== card.draft) target.draft = card.draft;
  if (target.merged !== card.merged) target.merged = card.merged;
  if (target.headBranch !== card.headBranch) target.headBranch = card.headBranch;
  if (target.checksState !== card.checksState) target.checksState = card.checksState;
  if (target.reviewState !== card.reviewState) target.reviewState = card.reviewState;
  return target;
}

/** Make `state.issues` / `state.pulls` equal `board`. */
export function syncBoard(state: OperationRoomState, board: BoardCards): void {
  const issues = new Map(board.issues.map((c) => [boardCardKey(c.repoId, c.number), c]));
  for (const key of [...state.issues.keys()]) if (!issues.has(key)) state.issues.delete(key);
  for (const [key, card] of issues) {
    const existing = state.issues.get(key);
    if (existing) writeCard(existing, card);
    else {
      const entry = new IssueCardSchema();
      writeCard(entry, card);
      state.issues.set(key, entry);
    }
  }
  const pulls = new Map(board.pulls.map((c) => [boardCardKey(c.repoId, c.number), c]));
  for (const key of [...state.pulls.keys()]) if (!pulls.has(key)) state.pulls.delete(key);
  for (const [key, card] of pulls) {
    const existing = state.pulls.get(key);
    if (existing) writePull(existing, card);
    else state.pulls.set(key, writePull(new PullCardSchema(), card));
  }
}
