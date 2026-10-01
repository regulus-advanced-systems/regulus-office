import { afterEach, describe, expect, test } from "bun:test";
import { LOBBY_OPERATION_ID } from "@regulus/protocol";
import {
  closeDatabase,
  type Db,
  MEMORY_DB_PATH,
  openDatabase,
  runMigrations,
  schema,
} from "../../db/index.ts";
import {
  DrizzleOperationSource,
  isKnownOperation,
  LOBBY_OPERATION,
  StaticOperationSource,
} from "./operations.ts";

const opened: Db[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) closeDatabase(db);
});

function openMigrated(): Db {
  const db = openDatabase({ path: MEMORY_DB_PATH });
  runMigrations(db);
  opened.push(db);
  return db;
}

async function seedOperation(db: Db, name: string, index: number, archived = false) {
  const [operation] = await db
    .insert(schema.operations)
    .values({
      name,
      slug: name.toLowerCase(),
      index,
      paletteId: "oak-sky",
      layoutTemplateId: "office-l2-small",
      archivedAt: archived ? new Date() : null,
    })
    .returning();
  if (!operation) throw new Error("insert operations returned nothing");
  return operation;
}

async function seedAgents(db: Db, operationId: string, statuses: string[]) {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Ada", email: `ada-${operationId}@example.com` })
    .returning();
  const [repo] = await db
    .insert(schema.operationRepos)
    .values({
      operationId,
      owner: "o",
      name: "r",
      url: "https://example.com/o/r",
      workdir: "/tmp/r",
    })
    .returning();
  if (!user || !repo) throw new Error("seed failed");
  for (const status of statuses) {
    await db.insert(schema.agents).values({
      operationId,
      repoId: repo.id,
      deskSeatId: "seat-1",
      ownerUserId: user.id,
      provider: "claude-code",
      model: "opus",
      profileId: "office:claude-code",
      status: status as "idle",
      workdir: "/tmp/r",
      taskTitle: "t",
    });
  }
}

describe("DrizzleOperationSource", () => {
  test("lists the lobby first, then operations by index, skipping archived ones", async () => {
    const db = openMigrated();
    await seedOperation(db, "Beta", 2);
    await seedOperation(db, "Alpha", 1);
    await seedOperation(db, "Old", 3, true);
    const list = await new DrizzleOperationSource(db).listOperations();
    expect(list.map((f) => f.name)).toEqual(["Lobby", "Alpha", "Beta"]);
    expect(list[0]).toEqual(LOBBY_OPERATION);
    expect(list[1]).toMatchObject({
      slug: "alpha",
      index: 1,
      paletteId: "oak-sky",
      henchmenTotal: 0,
      // Room settings travel with the summary so every client can draw the room (#186).
      deskCount: 1,
      decorStyle: "ops_room",
    });
  });

  test("counts working, waiting and present henchmen per operation", async () => {
    const db = openMigrated();
    const operation = await seedOperation(db, "Alpha", 1);
    await seedAgents(db, operation.id, [
      "working",
      "working",
      "waiting_permission",
      "waiting_input",
      "idle",
      "exited",
      "offline",
    ]);
    const [, alpha] = await new DrizzleOperationSource(db).listOperations();
    expect(alpha).toMatchObject({ henchmenWorking: 2, henchmenWaiting: 2, henchmenTotal: 5 });
  });
});

describe("operation helpers", () => {
  test("isKnownOperation accepts the lobby and listed operations only", async () => {
    const source = new StaticOperationSource([
      { ...LOBBY_OPERATION, operationId: "f1", name: "F1", index: 1 },
    ]);
    const list = await source.listOperations();
    expect(isKnownOperation(LOBBY_OPERATION_ID, list)).toBe(true);
    expect(isKnownOperation("f1", list)).toBe(true);
    expect(isKnownOperation("f2", list)).toBe(false);
  });
});
