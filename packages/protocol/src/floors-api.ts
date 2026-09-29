/**
 * REST shapes for floors (= projects) and their repos (SPEC §5 `floors`,
 * `floor_repos`, `floor_members`; §9.1; D7, D14). Floors are created and
 * managed over HTTP; the FloorRoom (SPEC §6 channel 2) carries live state.
 *
 * Repo credentials are write-only: a request may carry a fine-grained PAT
 * for a repo, a response only ever says whether one is stored (SPEC §8).
 */
import { z } from "zod";
import { Id, TimestampMs } from "./common.ts";
import { FLOOR_ACCESSES, FLOOR_TEMPLATE_TIERS, REPO_CLONE_STATUSES, USER_ROLES } from "./enums.ts";

export const FLOORS_API_PATH = "/api/floors";

/** Most repos a floor may be created with in one request. */
export const MAX_REPOS_PER_FLOOR = 8;

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

export const CreateFloorRequest = z.object({
  name: z.string().trim().min(1).max(80),
  /** Palette id from @regulus/floor-layout; omitted = next in the cycle. */
  paletteId: z.string().trim().min(1).max(32).optional(),
  tier: z.enum(FLOOR_TEMPLATE_TIERS).default("medium"),
  repos: z.array(RepoInput).min(1).max(MAX_REPOS_PER_FLOOR),
});
export type CreateFloorRequest = z.input<typeof CreateFloorRequest>;

export const FloorRepoInfo = z.object({
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
export type FloorRepoInfo = z.infer<typeof FloorRepoInfo>;

export const FloorInfo = z.object({
  floorId: Id,
  name: z.string().max(80),
  slug: z.string().max(80),
  index: z.number().int().positive(),
  paletteId: z.string().max(32),
  layoutTemplateId: z.string().max(64),
  archivedAt: TimestampMs.nullable(),
  /** The caller's effective access (owner/admin: always `manage`). */
  access: z.enum(FLOOR_ACCESSES),
  repos: z.array(FloorRepoInfo),
});
export type FloorInfo = z.infer<typeof FloorInfo>;

export const FloorListResponse = z.object({ floors: z.array(FloorInfo) });
export type FloorListResponse = z.infer<typeof FloorListResponse>;

export const FloorMemberInfo = z.object({
  userId: Id,
  displayName: z.string().max(64),
  access: z.enum(FLOOR_ACCESSES),
});
export type FloorMemberInfo = z.infer<typeof FloorMemberInfo>;

export const FloorMembersResponse = z.object({ members: z.array(FloorMemberInfo) });
export type FloorMembersResponse = z.infer<typeof FloorMembersResponse>;

/**
 * `GET /api/users`: the office's people, for picking whom to grant floor
 * access. Open to anyone who can manage at least one floor; `email` is only
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

/** Body of `PUT /api/floors/:floorId/members/:userId`. */
export const SetFloorMemberRequest = z.object({ access: z.enum(FLOOR_ACCESSES) });
export type SetFloorMemberRequest = z.infer<typeof SetFloorMemberRequest>;

/** Body of `POST /api/floors/:floorId/repos/:repoId/clone`: retry, optionally with a new PAT. */
export const RetryCloneRequest = z.object({ token: RepoToken.optional() });
export type RetryCloneRequest = z.infer<typeof RetryCloneRequest>;

/** Rank of each access level; higher includes everything below. */
export const FLOOR_ACCESS_RANK: Readonly<Record<(typeof FLOOR_ACCESSES)[number], number>> = {
  view: 1,
  spawn: 2,
  manage: 3,
};

/** True when `have` grants at least `need`. */
export function hasFloorAccess(
  have: (typeof FLOOR_ACCESSES)[number] | null | undefined,
  need: (typeof FLOOR_ACCESSES)[number],
): boolean {
  return have ? FLOOR_ACCESS_RANK[have] >= FLOOR_ACCESS_RANK[need] : false;
}
