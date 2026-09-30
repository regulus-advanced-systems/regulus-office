/** Fixtures for the search tests: an office with floors, members, robots and chat. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FloorAccess, UserRole } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { agents, chatMessages, floorMembers, floorRepos, floors } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { SearchIndexer } from "./indexer.ts";

export const silent = createLogger({ level: "silent" });

export function addFloor(db: Db, id: string, archived = false): void {
  db.insert(floors)
    .values({
      id,
      name: `Floor ${id}`,
      slug: id,
      index: Number(id.replace(/\D/g, "") || 1),
      paletteId: "teal",
      layoutTemplateId: "l2",
      archivedAt: archived ? new Date() : null,
    })
    .run();
  db.insert(floorRepos)
    .values({
      id: `r-${id}`,
      floorId: id,
      owner: "o",
      name: id,
      url: "https://x.invalid",
      workdir: "/tmp",
    })
    .run();
}

export function addMember(db: Db, floorId: string, userId: string, access: FloorAccess): void {
  db.insert(floorMembers).values({ floorId, userId, access }).run();
}

export function addRobot(db: Db, id: string, floorId: string, ownerUserId: string): void {
  db.insert(agents)
    .values({
      id,
      floorId,
      repoId: `r-${floorId}`,
      deskSeatId: `desk-${id}`,
      ownerUserId,
      provider: "custom",
      model: "m",
      profileId: "p",
      workdir: "/tmp",
      taskTitle: `task ${id}`,
    })
    .run();
}

export function exitRobot(db: Db, id: string): void {
  db.update(agents).set({ exitedAt: new Date() }).where(eq(agents.id, id)).run();
}

let chatSeq = 0;
export function addChat(db: Db, text: string, floorId = "", ts = Date.now()): string {
  chatSeq += 1;
  const id = `chat-${chatSeq}`;
  db.insert(chatMessages)
    .values({ id, userId: "u", displayName: "Ada", floorId, text, ts: new Date(ts) })
    .run();
  return id;
}

export function tempDir(): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), "rg41-search-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function indexerFor(db: Db, scrollbackDir: string): SearchIndexer {
  return new SearchIndexer({ db, scrollbackDir, logger: silent, intervalMs: 60_000 });
}

/** Rows in the index for one source. */
export function docCount(db: Db, kind: string, sourceId?: string): number {
  const row = sourceId
    ? db.$client
        .query<{ n: number }, [string, string]>(
          "SELECT count(*) AS n FROM search_docs WHERE kind = ? AND source_id = ?",
        )
        .get(kind, sourceId)
    : db.$client
        .query<{ n: number }, [string]>("SELECT count(*) AS n FROM search_docs WHERE kind = ?")
        .get(kind);
  return row?.n ?? 0;
}
