/**
 * REST shapes for the issue and PR boards (SPEC §9.4, D7; #36). The boards
 * themselves travel in the OperationRoom state (`OperationState.issues` / `pulls`,
 * #35); these routes give one card's detail (markdown body from the cache,
 * comments read live) and the write actions: assign, comment, merge
 * (squash / merge / rebase) and close.
 *
 * Writes are for humans with operation `manage` (office owners and admins have
 * it on every operation). The server authorises and audits each one and calls
 * GitHub with the operation repo's office credential (the App installation
 * token, else the org PAT), never a human's own token.
 *
 *   GET  /api/boards/:operationId/:kind/:repoId/:number           card detail
 *   POST /api/boards/:operationId/:kind/:repoId/:number/comment   { body }
 *   POST /api/boards/:operationId/:kind/:repoId/:number/assign    { add, remove }
 *   POST /api/boards/:operationId/:kind/:repoId/:number/merge     { method }  (PRs)
 *   POST /api/boards/:operationId/:kind/:repoId/:number/close     {}
 *   GET  /api/boards/:operationId/:repoId/assignees               { logins }
 */
import { z } from "zod";
import { GhNumber, Id, TimestampMs } from "./common.ts";
import {
  CARD_KINDS,
  type CardKind,
  CHECKS_STATES,
  OPERATION_ACCESSES,
  REVIEW_STATES,
} from "./enums.ts";
import { GitHubLogin } from "./github-api.ts";

export const BOARDS_API_PATH = "/api/boards";

export const MERGE_METHODS = ["squash", "merge", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

export const BOARD_ACTIONS = ["comment", "assign", "merge", "close"] as const;
export type BoardAction = (typeof BOARD_ACTIONS)[number];

/** Footer the office appends to every comment it posts for a human. */
export const VIA_OFFICE = "via Regulus Office";

export function boardCardPath(
  operationId: string,
  kind: CardKind,
  repoId: string,
  number: number,
  action?: BoardAction,
): string {
  const e = encodeURIComponent;
  const base = `${BOARDS_API_PATH}/${e(operationId)}/${kind}/${e(repoId)}/${number}`;
  return action ? `${base}/${action}` : base;
}

export function boardAssigneesPath(operationId: string, repoId: string): string {
  return `${BOARDS_API_PATH}/${encodeURIComponent(operationId)}/${encodeURIComponent(repoId)}/assignees`;
}

type Access = (typeof OPERATION_ACCESSES)[number];

/** Assign, comment, merge and close: operation `manage` (office owners/admins get it everywhere). */
export function mayWriteBoard(access: Access | null | undefined): boolean {
  return access === "manage";
}

/** Plucking a card to carry it to a desk: whoever may spawn henchmen there. */
export function mayCarryCard(access: Access | null | undefined): boolean {
  return access === "manage" || access === "spawn";
}

export const BoardComment = z.object({
  id: z.number().int(),
  author: z.string().max(64),
  bodyMd: z.string().max(65_536),
  createdAt: TimestampMs,
  url: z.string().max(512),
});
export type BoardComment = z.infer<typeof BoardComment>;

export const BoardCardDetail = z.object({
  kind: z.enum(CARD_KINDS),
  repoId: Id,
  /** `owner/name`. */
  repo: z.string().max(201),
  number: GhNumber,
  title: z.string().max(300),
  state: z.string().max(16),
  merged: z.boolean(),
  draft: z.boolean(),
  author: z.string().max(64),
  labels: z.array(z.string().max(64)),
  assignees: z.array(z.string().max(64)),
  url: z.string().max(512),
  /** Markdown as written on GitHub; clients render it sanitised (no raw HTML). */
  bodyMd: z.string().max(65_536),
  updatedAt: TimestampMs,
  headBranch: z.string().max(200),
  baseBranch: z.string().max(200),
  checksState: z.enum(CHECKS_STATES),
  reviewState: z.enum(REVIEW_STATES),
  comments: z.array(BoardComment),
  /** Why comments could not be read (no office credential, GitHub down); null when they were. */
  commentsError: z.string().max(300).nullable(),
  /** The viewer may assign, comment, merge and close (operation `manage`). */
  canWrite: z.boolean(),
  /** An office credential covers this repo, so writes can reach GitHub. */
  credential: z.boolean(),
});
export type BoardCardDetail = z.infer<typeof BoardCardDetail>;

export const BoardCommentRequest = z.object({ body: z.string().trim().min(1).max(8_000) });
export type BoardCommentRequest = z.infer<typeof BoardCommentRequest>;

export const BoardAssignRequest = z
  .object({
    add: z.array(GitHubLogin).max(10).default([]),
    remove: z.array(GitHubLogin).max(10).default([]),
  })
  .refine((r) => r.add.length + r.remove.length > 0, { message: "nothing to change" });
export type BoardAssignRequest = z.input<typeof BoardAssignRequest>;

export const BoardMergeRequest = z.object({ method: z.enum(MERGE_METHODS) });
export type BoardMergeRequest = z.infer<typeof BoardMergeRequest>;

export const BoardAssigneesResponse = z.object({ logins: z.array(z.string().max(64)) });
export type BoardAssigneesResponse = z.infer<typeof BoardAssigneesResponse>;

/** Error codes the board routes answer with (`{ error, detail? }`). */
export const BOARD_ERRORS = [
  "card_not_found",
  "not_a_pull_request",
  "manage_required",
  "office_credential_missing",
  "github_rejected",
  "github_unavailable",
] as const;
export type BoardError = (typeof BOARD_ERRORS)[number];
