/** Operation and repo rows as the REST API returns them (protocol `OperationInfo`, `OperationRepoInfo`). */
import type { OperationAccess, OperationInfo, OperationRepoInfo } from "@regulus/protocol";
import { asc, eq } from "drizzle-orm";
import type { DbOrTx } from "../auth/audit.ts";
import { operationRepos, type operations } from "../db/schema/index.ts";

type OperationRow = typeof operations.$inferSelect;
type RepoRow = typeof operationRepos.$inferSelect;

export function repoInfo(row: RepoRow): OperationRepoInfo {
  return {
    repoId: row.id,
    owner: row.owner,
    name: row.name,
    url: row.url,
    defaultBranch: row.defaultBranch,
    isPrimary: row.isPrimary,
    cloneStatus: row.cloneStatus,
    cloneError: row.cloneError,
    hasCredential: row.encryptedCredential !== null,
  };
}

/** One operation with its repo (a list of one, #268; none only for a pre-repo operation). */
export function operationInfo(
  db: DbOrTx,
  row: OperationRow,
  access: OperationAccess,
): OperationInfo {
  const repos = db
    .select()
    .from(operationRepos)
    .where(eq(operationRepos.operationId, row.id))
    .orderBy(asc(operationRepos.createdAt))
    .all()
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  return {
    operationId: row.id,
    levelId: row.levelId,
    name: row.name,
    slug: row.slug,
    index: row.index,
    paletteId: row.paletteId,
    layoutTemplateId: row.layoutTemplateId,
    archivedAt: row.archivedAt ? row.archivedAt.getTime() : null,
    access,
    repos: repos.map(repoInfo),
  };
}
