/** Floor and repo rows as the REST API returns them (protocol `FloorInfo`, `FloorRepoInfo`). */
import type { FloorAccess, FloorInfo, FloorRepoInfo } from "@regulus/protocol";
import { asc, eq } from "drizzle-orm";
import type { DbOrTx } from "../auth/audit.ts";
import { floorRepos, type floors } from "../db/schema/index.ts";

type FloorRow = typeof floors.$inferSelect;
type RepoRow = typeof floorRepos.$inferSelect;

export function repoInfo(row: RepoRow): FloorRepoInfo {
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

/** One floor with its repos, primary first. */
export function floorInfo(db: DbOrTx, row: FloorRow, access: FloorAccess): FloorInfo {
  const repos = db
    .select()
    .from(floorRepos)
    .where(eq(floorRepos.floorId, row.id))
    .orderBy(asc(floorRepos.createdAt))
    .all()
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  return {
    floorId: row.id,
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
