/**
 * A person's own GitHub access (SPEC D26, D27; #251, #267): each person links
 * their GitHub account by OAuth, and the office keeps a snapshot of what that
 * account can see (organisations, and a permission per office repo).
 *
 * This file is the single source for the permission levels, the mapping from
 * a GitHub permission to what a person may do in a room, and the REST shapes
 * of the link. A response never carries the person's GitHub token.
 */
import { z } from "zod";
import { TimestampMs } from "./common.ts";
import type { OperationAccess } from "./enums.ts";
import { GITHUB_API_PATH } from "./github-api.ts";

/** GitHub's repository permission levels, lowest to highest; `none` is no access at all. */
export const GITHUB_REPO_PERMISSIONS = [
  "none",
  "read",
  "triage",
  "write",
  "maintain",
  "admin",
] as const;
export type GitHubRepoPermission = (typeof GITHUB_REPO_PERMISSIONS)[number];

export function isGitHubRepoPermission(value: unknown): value is GitHubRepoPermission {
  return (GITHUB_REPO_PERMISSIONS as readonly unknown[]).includes(value);
}

/** True when `have` is `need` or higher. */
export function repoPermissionAtLeast(
  have: GitHubRepoPermission,
  need: GitHubRepoPermission,
): boolean {
  return GITHUB_REPO_PERMISSIONS.indexOf(have) >= GITHUB_REPO_PERMISSIONS.indexOf(need);
}

/**
 * What a GitHub permission on a room's repo lets a person do in that room
 * (#267, proposed; the owner confirms after the wave):
 *
 * - `read`, `triage` → `view`: enter the room and watch.
 * - `write`, `maintain` → `spawn`: work in the room (spawn and control their own henchmen).
 * - `admin` → `manage`: manage the room.
 * - `none` → null: the room stays closed and reveals nothing (D26).
 */
export function operationAccessForRepoPermission(
  permission: GitHubRepoPermission,
): OperationAccess | null {
  switch (permission) {
    case "admin":
      return "manage";
    case "maintain":
    case "write":
      return "spawn";
    case "triage":
    case "read":
      return "view";
    default:
      return null;
  }
}

export const GITHUB_LINK_API_PATH = `${GITHUB_API_PATH}/link`;
/** `POST`: where to send the browser on github.com to authorise the link. */
export const GITHUB_LINK_START_API_PATH = `${GITHUB_LINK_API_PATH}/start`;
/** GitHub redirects here with `code` and `state`. Register it as a callback URL of the OAuth client. */
export const GITHUB_LINK_CALLBACK_PATH = `${GITHUB_LINK_API_PATH}/callback`;
/** `POST`: check now. */
export const GITHUB_LINK_CHECK_API_PATH = `${GITHUB_LINK_API_PATH}/check`;
/** Query parameter the office page gets after the link flow: `linked` or an error code. */
export const GITHUB_LINK_RESULT_PARAM = "github_link";

/**
 * `not_linked`: never linked, or unlinked. `linked`: the snapshot is kept
 * current. `revoked`: GitHub refused the token (revoked or expired); the
 * snapshot is empty until the person links again.
 */
export const GITHUB_LINK_STATES = ["not_linked", "linked", "revoked"] as const;
export type GitHubLinkState = (typeof GITHUB_LINK_STATES)[number];

/** Why linking is not possible on this office, or null when it is. */
export const GITHUB_LINK_UNAVAILABLE_REASONS = [
  "oauth_not_configured",
  "master_key_required",
] as const;

/** One office repo the person can see, with what it lets them do in its room. */
export const GitHubVisibleRepo = z.object({
  repoId: z.string().max(100),
  /** `owner/name`. */
  fullName: z.string().max(201),
  permission: z.enum(GITHUB_REPO_PERMISSIONS),
  access: z.enum(["manage", "spawn", "view"]),
});
export type GitHubVisibleRepo = z.infer<typeof GitHubVisibleRepo>;

/** The viewer's own link (`GET /api/github/link`). Never a token. */
export const GitHubLinkStatus = z.object({
  /** False when the office has no GitHub OAuth client or no master key. */
  available: z.boolean(),
  unavailableReason: z.enum(GITHUB_LINK_UNAVAILABLE_REASONS).nullable(),
  state: z.enum(GITHUB_LINK_STATES),
  login: z.string().max(100).nullable(),
  linkedAt: TimestampMs.nullable(),
  /** When GitHub was last asked, successfully or not. */
  lastCheckedAt: TimestampMs.nullable(),
  /** Why the last check did not complete (redacted), or null. */
  lastError: z.string().max(300).nullable(),
  /** Organisations the account is an active member of. */
  organizations: z.array(z.string().max(100)).max(500),
  /** Only repos the person can see; a hidden repo is not listed or counted (D26). */
  repos: z.array(GitHubVisibleRepo).max(2000),
});
export type GitHubLinkStatus = z.infer<typeof GitHubLinkStatus>;

/** Answer of `POST /api/github/link/start`: navigate the browser to `url` (github.com). */
export const StartGitHubLinkResponse = z.object({ url: z.string().max(1000) });
export type StartGitHubLinkResponse = z.infer<typeof StartGitHubLinkResponse>;
