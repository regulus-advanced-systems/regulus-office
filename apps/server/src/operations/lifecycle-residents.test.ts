/**
 * What lives in a room besides henchmen goes with it (#56): the operations
 * code tells the residents (board helpers, wired in index.ts) when a room is
 * archived, and before a room's row is deleted, so a helper is stopped and
 * removed with its room and no card with the room's name is left behind.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { operations as operationsTable } from "../db/schema/index.ts";
import { seedRoomMember } from "../github/access/test-snapshot.ts";
import { createLogger } from "../logging.ts";
import { createOperations } from "./index.ts";
import { makeBareRepo, testDb } from "./test-helpers.ts";

let root: string;
let remoteBase: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rg56-residents-"));
  remoteBase = await makeBareRepo(join(root, "remotes"), "octo", "hello", "trunk");
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function setup() {
  const { db, addUser } = testDb();
  const base = join(root, randomUUID().slice(0, 8));
  const operations = createOperations({
    db,
    logger: createLogger({ level: "silent" }),
    config: {
      projectsDir: join(base, "projects"),
      worktreesDir: join(base, "worktrees"),
      githubRemoteBase: remoteBase,
    },
    keyring: undefined,
  });
  const owner = addUser("Olga", "owner");
  const { operation, cloned } = operations.service.create(owner, {
    name: "Apollo",
    tier: "small",
    repos: [{ repo: "octo/hello" }],
  });
  await cloned;
  seedRoomMember(db, owner.id, operation.operationId, "manage");
  const rowThere = () =>
    db.select().from(operationsTable).where(eq(operationsTable.id, operation.operationId)).get() !==
    undefined;
  /** What the residents were told, with whether the room's row was still there. */
  const told: string[] = [];
  operations.lifecycle.residents = {
    roomArchived: async (id) => void told.push(`archived ${id}`),
    roomDeleted: async (id) => void told.push(`deleted ${id} row=${rowThere()}`),
  };
  operations.service.onArchived = (id) => void told.push(`archived ${id}`);
  return { operations, owner, id: operation.operationId, told, rowThere };
}

describe("a room's residents", () => {
  test("are told when the room is archived", async () => {
    const t = await setup();
    t.operations.service.archive(t.owner, t.id);
    expect(t.told).toEqual([`archived ${t.id}`]);
    // Restoring tells nobody: a helper is simply there again.
    t.operations.lifecycle.restore(t.owner, t.id);
    expect(t.told).toEqual([`archived ${t.id}`]);
  });

  test("are told before the room's row is deleted, while what they hold can still be found", async () => {
    const t = await setup();
    await t.operations.lifecycle.delete(t.owner, t.id, "Apollo");
    expect(t.told).toEqual([`deleted ${t.id} row=true`]);
    expect(t.rowThere()).toBe(false);
  });

  test("a delete that is refused tells nobody", async () => {
    const t = await setup();
    await expect(t.operations.lifecycle.delete(t.owner, t.id, "Wrong name")).rejects.toThrow();
    expect(t.told).toEqual([]);
    expect(t.rowThere()).toBe(true);
  });
});
