import { afterEach, describe, expect, test } from "bun:test";
import { LOBBY_FLOOR_ID } from "@regulus/protocol";
import {
  closeDatabase,
  type Db,
  MEMORY_DB_PATH,
  openDatabase,
  runMigrations,
  schema,
} from "../../db/index.ts";
import { DrizzleFloorSource, isKnownFloor, LOBBY_FLOOR, StaticFloorSource } from "./floors.ts";

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

async function seedFloor(db: Db, name: string, index: number, archived = false) {
  const [floor] = await db
    .insert(schema.floors)
    .values({
      name,
      slug: name.toLowerCase(),
      index,
      paletteId: "oak-sky",
      layoutTemplateId: "office-l2-small",
      archivedAt: archived ? new Date() : null,
    })
    .returning();
  if (!floor) throw new Error("insert floors returned nothing");
  return floor;
}

async function seedAgents(db: Db, floorId: string, statuses: string[]) {
  const [user] = await db
    .insert(schema.users)
    .values({ name: "Ada", email: `ada-${floorId}@example.com` })
    .returning();
  const [repo] = await db
    .insert(schema.floorRepos)
    .values({ floorId, owner: "o", name: "r", url: "https://example.com/o/r", workdir: "/tmp/r" })
    .returning();
  if (!user || !repo) throw new Error("seed failed");
  for (const status of statuses) {
    await db.insert(schema.agents).values({
      floorId,
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

describe("DrizzleFloorSource", () => {
  test("lists the lobby first, then floors by index, skipping archived ones", async () => {
    const db = openMigrated();
    await seedFloor(db, "Beta", 2);
    await seedFloor(db, "Alpha", 1);
    await seedFloor(db, "Old", 3, true);
    const list = await new DrizzleFloorSource(db).listFloors();
    expect(list.map((f) => f.name)).toEqual(["Lobby", "Alpha", "Beta"]);
    expect(list[0]).toEqual(LOBBY_FLOOR);
    expect(list[1]).toMatchObject({
      slug: "alpha",
      index: 1,
      paletteId: "oak-sky",
      robotsTotal: 0,
    });
  });

  test("counts working, waiting and present robots per floor", async () => {
    const db = openMigrated();
    const floor = await seedFloor(db, "Alpha", 1);
    await seedAgents(db, floor.id, [
      "working",
      "working",
      "waiting_permission",
      "waiting_input",
      "idle",
      "exited",
      "offline",
    ]);
    const [, alpha] = await new DrizzleFloorSource(db).listFloors();
    expect(alpha).toMatchObject({ robotsWorking: 2, robotsWaiting: 2, robotsTotal: 5 });
  });
});

describe("floor helpers", () => {
  test("isKnownFloor accepts the lobby and listed floors only", async () => {
    const source = new StaticFloorSource([{ ...LOBBY_FLOOR, floorId: "f1", name: "F1", index: 1 }]);
    const list = await source.listFloors();
    expect(isKnownFloor(LOBBY_FLOOR_ID, list)).toBe(true);
    expect(isKnownFloor("f1", list)).toBe(true);
    expect(isKnownFloor("f2", list)).toBe(false);
  });
});
