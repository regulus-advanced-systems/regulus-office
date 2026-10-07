/**
 * REST shapes for operations (= projects) and their repos (SPEC §5 `operations`,
 * `operation_repos`, `operation_members`; §9.1; D7, D14). Operations are created and
 * managed over HTTP; the OperationRoom (SPEC §6 channel 2) carries live state.
 *
 * Repo credentials are write-only: a request may carry a fine-grained PAT
 * for a repo, a response only ever says whether one is stored (SPEC §8).
 */
import { z } from "zod";
import { Id, TimestampMs } from "./common.ts";
import {
  AGENT_STATUSES,
  OPERATION_ACCESSES,
  REPO_CLONE_STATUSES,
  ROOM_TEMPLATE_TIERS,
  USER_ROLES,
} from "./enums.ts";

export const OPERATIONS_API_PATH = "/api/operations";

/**
 * An operation has exactly one repo (D7 as changed 2026-10-07): one room per
 * repo. The create request keeps the `repos` list of the 1..n days, with
 * exactly one entry; work on another repo is another room.
 */
export const MAX_REPOS_PER_OPERATION = 1;
/** Shown when a request names several repos for one room. */
export const ONE_REPO_PER_ROOM_MESSAGE =
  "A room has exactly one repo. Add another room for each other repo.";

/**
 * A GitHub token: printable ASCII only, so it can never smuggle a header
 * break into `http.extraHeader` or a URL.
 */
export const RepoToken = z
  .string()
  .trim()
  .min(8)
  .max(512)
  .regex(/^[\x21-\x7e]+$/, "must be printable ASCII without spaces");

export const RepoInput = z.object({
  /** `owner/name` or `https://github.com/owner/name(.git)`. */
  repo: z.string().trim().min(3).max(300),
  /** Optional fine-grained PAT scoped to this repo (D14 fallback); public repos need none. */
  token: RepoToken.optional(),
});
export type RepoInput = z.infer<typeof RepoInput>;

export const CreateOperationRequest = z.object({
  name: z.string().trim().min(1).max(80),
  /** Palette id from @regulus/room-layout; omitted = next in the cycle. */
  paletteId: z.string().trim().min(1).max(32).optional(),
  tier: z.enum(ROOM_TEMPLATE_TIERS).default("medium"),
  /** Exactly one (see {@link MAX_REPOS_PER_OPERATION}); its owner decides the room's level (D26). */
  repos: z.array(RepoInput).min(1).max(MAX_REPOS_PER_OPERATION, ONE_REPO_PER_ROOM_MESSAGE),
});
export type CreateOperationRequest = z.input<typeof CreateOperationRequest>;

export const OperationRepoInfo = z.object({
  repoId: Id,
  owner: z.string().max(100),
  name: z.string().max(100),
  /** Public web URL of the repo (never carries credentials). */
  url: z.string().max(512),
  defaultBranch: z.string().max(200),
  isPrimary: z.boolean(),
  cloneStatus: z.enum(REPO_CLONE_STATUSES),
  /** Redacted, human-readable reason when `cloneStatus` is `error`. */
  cloneError: z.string().max(1000).nullable(),
  /** True when a PAT is stored for this repo; the token itself is never returned. */
  hasCredential: z.boolean(),
});
export type OperationRepoInfo = z.infer<typeof OperationRepoInfo>;

export const OperationInfo = z.object({
  operationId: Id,
  /** The level the room is on: its repo owner's (D7, D26). */
  levelId: Id,
  name: z.string().max(80),
  slug: z.string().max(80),
  index: z.number().int().positive(),
  paletteId: z.string().max(32),
  layoutTemplateId: z.string().max(64),
  archivedAt: TimestampMs.nullable(),
  /** The caller's effective access (owner/admin: always `manage`). */
  access: z.enum(OPERATION_ACCESSES),
  /** The room's one repo; empty only for an operation from before repos were required. */
  repos: z.array(OperationRepoInfo),
});
export type OperationInfo = z.infer<typeof OperationInfo>;

export const OperationListResponse = z.object({ operations: z.array(OperationInfo) });
export type OperationListResponse = z.infer<typeof OperationListResponse>;

export const OperationMemberInfo = z.object({
  userId: Id,
  displayName: z.string().max(64),
  access: z.enum(OPERATION_ACCESSES),
});
export type OperationMemberInfo = z.infer<typeof OperationMemberInfo>;

export const OperationMembersResponse = z.object({ members: z.array(OperationMemberInfo) });
export type OperationMembersResponse = z.infer<typeof OperationMembersResponse>;

/**
 * `GET /api/users`: the office's people, for picking whom to grant operation
 * access. Open to anyone who can manage at least one operation; `email` is only
 * present when the caller is an office owner or admin.
 */
export const OFFICE_USERS_API_PATH = "/api/users";

export const OfficeUserInfo = z.object({
  userId: Id,
  displayName: z.string().max(64),
  role: z.enum(USER_ROLES),
  email: z.string().max(254).optional(),
});
export type OfficeUserInfo = z.infer<typeof OfficeUserInfo>;

export const OfficeUsersResponse = z.object({ users: z.array(OfficeUserInfo) });
export type OfficeUsersResponse = z.infer<typeof OfficeUsersResponse>;

/** Body of `PUT /api/operations/:operationId/members/:userId`. */
export const SetOperationMemberRequest = z.object({ access: z.enum(OPERATION_ACCESSES) });
export type SetOperationMemberRequest = z.infer<typeof SetOperationMemberRequest>;

/** Body of `POST /api/operations/:operationId/repos/:repoId/clone`: retry, optionally with a new PAT. */
export const RetryCloneRequest = z.object({ token: RepoToken.optional() });
export type RetryCloneRequest = z.infer<typeof RetryCloneRequest>;

/**
 * Operation lifecycle (#150), office owners and admins only:
 *
 *   GET    /api/operations/archived                archived operations (Settings → Operations)
 *   POST   /api/operations/:operationId/archive        hide it; data and clones are kept
 *   POST   /api/operations/:operationId/restore        bring an archived operation back
 *   POST   /api/operations/:operationId/send-home      send every henchman on it home (branches kept)
 *   DELETE /api/operations/:operationId                delete for good (body: {@link DeleteOperationRequest})
 *
 * Delete is refused with 409 `operation_has_henchmen` (body: `{ error, henchmen }`)
 * while henchmen are still on the operation. It never touches GitHub.
 */
export const OPERATIONS_ARCHIVED_API_PATH = `${OPERATIONS_API_PATH}/archived`;

/** Body of `DELETE /api/operations/:operationId`: the operation's name, typed to confirm. */
export const DeleteOperationRequest = z.object({ confirmName: z.string().max(200) });
export type DeleteOperationRequest = z.infer<typeof DeleteOperationRequest>;

/** A henchman still on an operation that is about to be deleted. */
export const OperationHenchmanInfo = z.object({
  agentId: Id,
  ownerUserId: Id,
  ownerName: z.string().max(64),
  status: z.enum(AGENT_STATUSES),
  taskTitle: z.string().max(500),
  /** True while its process is believed to be running (not exited, offline). */
  running: z.boolean(),
});
export type OperationHenchmanInfo = z.infer<typeof OperationHenchmanInfo>;

/** 409 body of a refused delete. */
export const OperationHasHenchmenResponse = z.object({
  error: z.literal("operation_has_henchmen"),
  henchmen: z.array(OperationHenchmanInfo),
});
export type OperationHasHenchmenResponse = z.infer<typeof OperationHasHenchmenResponse>;

/** Result of `POST /api/operations/:operationId/send-home`. */
export const SendOperationHomeResponse = z.object({
  sentHome: z.number().int().nonnegative(),
  failed: z.array(z.object({ agentId: Id, reason: z.string().max(500) })),
});
export type SendOperationHomeResponse = z.infer<typeof SendOperationHomeResponse>;

/** Rank of each access level; higher includes everything below. */
export const OPERATION_ACCESS_RANK: Readonly<Record<(typeof OPERATION_ACCESSES)[number], number>> =
  {
    view: 1,
    spawn: 2,
    manage: 3,
  };

/** True when `have` grants at least `need`. */
export function hasOperationAccess(
  have: (typeof OPERATION_ACCESSES)[number] | null | undefined,
  need: (typeof OPERATION_ACCESSES)[number],
): boolean {
  return have ? OPERATION_ACCESS_RANK[have] >= OPERATION_ACCESS_RANK[need] : false;
}
