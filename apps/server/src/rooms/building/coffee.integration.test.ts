/**
 * The coffee buzz over the wire (#63): a cup at the break-room machine sets
 * the drinker's `cups` and `buzzUntil` for everyone who sees them and for
 * nobody who does not; a cup asked for from across the lobby, from another
 * level or too soon is refused; and a buzzed client that moves fast is
 * taken at its word, like any other (the server checks no speed).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import {
  BUZZ_MS,
  BuildingStateSchema,
  COFFEE_COOLDOWN_MS,
  COFFEE_DRINK,
  COMMAND_REJECTED_MESSAGE,
  type CommandRejected,
  type CompoundState,
  EMPTY_COMPOUND,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  ROOM_NAMES,
} from "@regulus/protocol";
import { coffeeMachineSpot } from "@regulus/room-layout";
import { closeDatabase, type Db, openDatabase, runMigrations, schema } from "../../db/index.ts";
import { seedRoomAccess, seedRoomRepo } from "../../github/access/test-snapshot.ts";
import { createOfficeServer, type OfficeServer } from "../../http/server.ts";
import { createLogger } from "../../logging.ts";
import { createDevHeaderAuth, DEV_USER_HEADER } from "../auth.ts";
import { createRooms, type Rooms } from "../index.ts";

type BuildingState = InstanceType<typeof BuildingStateSchema>;
type BuildingRoom = Room<unknown, BuildingState>;

const logger = createLogger({ level: "silent" });
const compound: CompoundState = {
  ...EMPTY_COMPOUND,
  width: 64,
  depth: 64,
  version: 3,
  specialRooms: [
    {
      kind: "break_room",
      gridX: 40,
      gridY: 56,
      width: 8,
      depth: 8,
      doorSide: "north",
      doorX: 43,
      doorY: 56,
    },
  ],
};
const VAULT = "room-vault";
const spot = coffeeMachineSpot(compound);
let dataDir: string;
let db: Db;
let rooms: Rooms;
let server: OfficeServer;
const opened: BuildingRoom[] = [];

const MIA = JSON.stringify({ userId: "u-mia", displayName: "Mia", role: "member" });
const GUS = JSON.stringify({ userId: "u-gus", displayName: "Gus", role: "member" });

async function joinAs(devUser: string): Promise<BuildingRoom> {
  const client = new Client(String(server.url).replace(/\/$/, ""), {
    headers: { [DEV_USER_HEADER]: devUser },
  });
  const room = await client.joinOrCreate<BuildingState>(
    ROOM_NAMES.building,
    {},
    BuildingStateSchema,
  );
  opened.push(room);
  return room;
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

const nextRejection = (room: BuildingRoom): Promise<CommandRejected> =>
  new Promise((resolve) => {
    const off = room.onMessage(COMMAND_REJECTED_MESSAGE, (msg: CommandRejected) => {
      off();
      resolve(msg);
    });
  });

const wire = (room: BuildingRoom) => JSON.stringify(room.state.toJSON());

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "office-coffee-"));
  db = openDatabase({ path: join(dataDir, "office.db") });
  runMigrations(db);
  for (const [id, name] of [
    ["u-mia", "Mia"],
    ["u-gus", "Gus"],
  ] as const) {
    db.insert(schema.users)
      .values({ id, name, email: `${id}@x.test` })
      .run();
    db.insert(schema.userProfiles).values({ userId: id, displayName: name, role: "member" }).run();
  }
  db.insert(schema.levels)
    .values({ id: "lv-mia", kind: "account", login: "mia", name: "mia", position: 1 })
    .run();
  db.insert(schema.operations)
    .values({
      id: VAULT,
      name: "Vault",
      slug: "vault",
      index: 1,
      paletteId: "oak-sky",
      layoutTemplateId: "l2",
      levelId: "lv-mia",
    })
    .run();
  seedRoomRepo(db, VAULT, "mia/vault");
  // Mia may enter the Vault; Gus has a link to nothing.
  seedRoomAccess(db, "u-mia", VAULT, "admin");
  rooms = createRooms({
    db,
    logger,
    auth: createDevHeaderAuth({ NODE_ENV: "test" }),
    publicUrl: "https://office.example.com",
    production: false,
  });
  const level = (levelId: string, kind: "lobby" | "account", login: string, order: number) =>
    ({ levelId, kind, login, name: login || "Lobby", order, state: compound }) as const;
  rooms.building.setCompound({
    state: compound,
    rooms: new Map([
      [
        VAULT,
        {
          gridX: 4,
          gridY: 20,
          width: 6,
          depth: 6,
          doorSide: "south" as const,
          doorX: 6,
          doorY: 26,
          buildState: "ready" as const,
          buildEndsAt: 0,
        },
      ],
    ]),
    levels: [level(LOBBY_LEVEL_ID, "lobby", "", 0), level("lv-mia", "account", "mia", 1)],
  });
  server = createOfficeServer({
    config: { port: 0, host: "127.0.0.1", webDist: join(dataDir, "no-dist") },
    logger,
    version: "test",
    attach: rooms.transport.attachment,
  });
  await rooms.transport.listen();
});

afterAll(async () => {
  await Promise.all(opened.splice(0).map((room) => Promise.race([room.leave(), Bun.sleep(200)])));
  await rooms.transport.shutdown();
  await server.stop(true);
  closeDatabase(db);
  await rm(dataDir, { recursive: true, force: true });
});

describe("coffee buzz over the wire", () => {
  test("a cup at the machine buzzes the drinker for those who see them, and only them", async () => {
    if (!spot) throw new Error("no coffee machine in the test compound");
    const mia = await joinAs(MIA);
    const gus = await joinAs(GUS);
    await waitFor(() => gus.state.humans.size === 2, "both humans");
    const miaFor = (room: BuildingRoom) => room.state.humans.get(mia.sessionId);
    expect(miaFor(gus)).toMatchObject({ cups: 0, buzzUntil: 0 });

    // From where she spawned, across the lobby: refused, nothing changes.
    const refused = nextRejection(mia);
    mia.send(COFFEE_DRINK, {});
    expect(await refused).toEqual({
      type: COFFEE_DRINK,
      reason: "Walk up to the coffee machine in the break room.",
    });

    mia.send("move", { x: spot.stand.x, z: spot.stand.z, heading: 0 });
    await waitFor(() => miaFor(gus)?.position.x === spot.stand.x, "Mia at the machine");
    const before = Date.now();
    mia.send(COFFEE_DRINK, {});
    await waitFor(() => miaFor(gus)?.cups === 1, "Gus sees Mia's cup");
    expect(miaFor(mia)?.cups).toBe(1);
    const until = miaFor(gus)?.buzzUntil ?? 0;
    expect(until).toBeGreaterThanOrEqual(before + BUZZ_MS);
    expect(until).toBeLessThanOrEqual(Date.now() + BUZZ_MS);
    // Gus drank nothing.
    expect(gus.state.humans.get(gus.sessionId)).toMatchObject({ cups: 0, buzzUntil: 0 });

    // A second cup at once is refused; after the cooldown it counts.
    const tooSoon = nextRejection(mia);
    mia.send(COFFEE_DRINK, {});
    expect((await tooSoon).reason).toBe("Finish that cup first.");
    await Bun.sleep(COFFEE_COOLDOWN_MS);
    mia.send(COFFEE_DRINK, {});
    await waitFor(() => miaFor(gus)?.cups === 2, "the second cup");

    // No speed is checked: a buzzed (or any) client's next position is taken as sent.
    mia.send("move", { x: spot.stand.x - 3, z: spot.stand.z, heading: 0 });
    await waitFor(() => miaFor(gus)?.position.x === spot.stand.x - 3, "the fast step");
    expect(miaFor(mia)?.position.x).toBe(spot.stand.x - 3);

    // Into a room Gus may not see: she is gone for him, buzz and all.
    mia.send("operation.go", { operationId: VAULT });
    await waitFor(() => miaFor(gus) === undefined, "Mia to vanish for Gus");
    await Bun.sleep(150);
    expect(wire(gus)).not.toContain("Mia");
    expect(miaFor(mia)?.cups).toBe(2);
    // On another level the same spot is not the machine.
    await Bun.sleep(COFFEE_COOLDOWN_MS);
    const elsewhere = nextRejection(mia);
    mia.send(COFFEE_DRINK, {});
    expect((await elsewhere).reason).toBe("Walk up to the coffee machine in the break room.");

    mia.send("operation.go", { operationId: LOBBY_OPERATION_ID, levelId: LOBBY_LEVEL_ID });
    await waitFor(() => miaFor(gus)?.cups === 2, "Mia back, still buzzed");
  }, 20_000);
});
