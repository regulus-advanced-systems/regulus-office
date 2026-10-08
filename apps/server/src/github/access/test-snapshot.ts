/**
 * TEST ONLY: write a person's GitHub access snapshot straight into a test
 * database (#270), as a refresh against GitHub would have left it. Rooms
 * open from the snapshot alone (operations/access.ts), so this is how unit
 * and integration tests say "this person's GitHub account can see that repo"
 * without running the OAuth flow; the flow itself is tested against the fake
 * GitHub (./service.test.ts, ./routes.test.ts) and used by the e2e suites.
 *
 * Nothing outside `*.test.ts` files and test helpers imports this file, and
 * it is not a switch: the access gate has no mode in which it trusts anything
 * but the snapshot. Rows written this way do not survive in a running office
 * either: a seeded link has no token, so the first refresh marks it revoked
 * and deletes its permissions.
 */
import type { GitHubRepoPermission, OperationAccess } from "@regulus/protocol";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/index.ts";
import { githubRepoPermissions, githubUserLinks, operationRepos } from "../../db/schema/index.ts";

let seq = 0;

/** The person has linked a GitHub account (no token: nothing here can call GitHub). */
export function seedGitHubLink(db: Db, userId: string, login = `gh-${userId}`): void {
  seq += 1;
  db.insert(githubUserLinks)
    .values({ userId, githubUserId: 900_000 + seq, login, linkedAt: new Date() })
    .onConflictDoNothing()
    .run();
}

/** The room's repo, created when the test's operation has none (`octo/<operation id>`). */
export function seedRoomRepo(db: Db, operationId: string, fullName?: string): string {
  const existing = db
    .select({ id: operationRepos.id })
    .from(operationRepos)
    .where(eq(operationRepos.operationId, operationId))
    .get();
  if (existing) return existing.id;
  const [owner, name] = (fullName ?? `octo/${operationId}`).split("/") as [string, string];
  const id = `repo-of-${operationId}`;
  db.insert(operationRepos)
    .values({
      id,
      operationId,
      owner,
      name,
      url: `https://github.com/${owner}/${name}`,
      workdir: `/nonexistent/rg270/${operationId}/${name}`,
      isPrimary: true,
      cloneStatus: "ready",
    })
    .run();
  return id;
}

/** The person's GitHub permission on one office repo, as the snapshot holds it (`none` removes it). */
export function seedRepoPermission(
  db: Db,
  userId: string,
  repoId: string,
  permission: GitHubRepoPermission,
): void {
  db.delete(githubRepoPermissions)
    .where(and(eq(githubRepoPermissions.userId, userId), eq(githubRepoPermissions.repoId, repoId)))
    .run();
  if (permission === "none") return;
  db.insert(githubRepoPermissions)
    .values({ userId, repoId, permission, checkedAt: new Date() })
    .run();
}

/**
 * "This person's GitHub account has `permission` on the room's repo": links
 * them, gives the room a repo if it has none, and stores the permission.
 * `read` → view, `write` → work, `admin` → manage. Returns the repo id.
 */
export function seedRoomAccess(
  db: Db,
  userId: string,
  operationId: string,
  permission: GitHubRepoPermission = "admin",
): string {
  seedGitHubLink(db, userId);
  const repoId = seedRoomRepo(db, operationId);
  seedRepoPermission(db, userId, repoId, permission);
  return repoId;
}

/** The lowest GitHub permission that gives each kind of room access. */
export const PERMISSION_FOR_ACCESS: Readonly<Record<OperationAccess, GitHubRepoPermission>> = {
  view: "read",
  spawn: "write",
  manage: "admin",
};

/**
 * {@link seedRoomAccess} in the office's own words: the person may `view`,
 * work in (`spawn`) or `manage` the room, because their GitHub account has
 * the matching permission on its repo. `null` takes the room away again.
 */
export function seedRoomMember(
  db: Db,
  userId: string,
  operationId: string,
  access: OperationAccess | null,
): string {
  return seedRoomAccess(db, userId, operationId, access ? PERMISSION_FOR_ACCESS[access] : "none");
}
