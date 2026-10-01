/**
 * Snapshot versions reach the rooms (#45): `OperationState.whiteboardVersion`
 * from the stored row when an OperationRoom opens and live on each upload,
 * and `BuildingState.lobbyWhiteboardVersion` for the lobby board.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Client, type Room } from "@colyseus/sdk";
import {
  BuildingStateSchema,
  LOBBY_WHITEBOARD_ID,
  OperationStateSchema,
  ROOM_NAMES,
} from "@regulus/protocol";
import { MEMORY_DB_PATH, openDatabase, runMigrations, schema } from "../db/index.ts";
import { createOfficeServer, type OfficeServer } from "../http/server.ts";
import { createLogger } from "../logging.ts";
import { createDevHeaderAuth, DEV_USER_HEADER } from "../rooms/auth.ts";
import { createRooms, type Rooms } from "../rooms/index.ts";
import { WhiteboardStore } from "./store.ts";
import { until } from "./test-helpers.ts";

const logger = createLogger({ level: "silent" });
const db = openDatabase({ path: MEMORY_DB_PATH });
let rooms: Rooms;
let server: OfficeServer;
const opened: Room[] = [];

const client = () =>
  new Client(String(server.url).replace(/\/$/, ""), {
    headers: {
      [DEV_USER_HEADER]: JSON.stringify({ userId: "u1", displayName: "U", role: "owner" }),
    },
  });

beforeAll(async () => {
  runMigrations(db);
  db.insert(schema.operations)
    .values({
      id: "op1",
      name: "One",
      slug: "one",
      index: 1,
      paletteId: "p",
      layoutTemplateId: "t",
    })
    .run();
  new WhiteboardStore(db).saveSnapshot("op1", "op1.png");
  rooms = createRooms({
    db,
    logger,
    auth: createDevHeaderAuth({ NODE_ENV: "test" }),
    publicUrl: "https://office.example.com",
    production: false,
  });
  server = createOfficeServer({
    config: { port: 0, host: "127.0.0.1", webDist: "/nonexistent" },
    logger,
    version: "test",
    attach: rooms.transport.attachment,
  });
  await rooms.transport.listen();
});

afterAll(async () => {
  await Promise.all(opened.map((r) => Promise.race([r.leave(), Bun.sleep(200)])));
  await rooms.transport.shutdown();
  await server.stop(true);
  db.$client.close();
});

test("an OperationRoom opens with the stored version and follows new snapshots", async () => {
  const room = await client().joinOrCreate(
    ROOM_NAMES.operation,
    { operationId: "op1" },
    OperationStateSchema,
  );
  opened.push(room);
  await until(() => room.state.operationId === "op1", "operation state");
  expect(room.state.whiteboardVersion).toBe(1);
  rooms.operations.publishWhiteboard("op1", 2);
  await until(() => room.state.whiteboardVersion === 2, "new version");
});

test("the lobby board's version is in the building state, also for rooms created later", async () => {
  rooms.building.setLobbyWhiteboard(5);
  const room = await client().joinOrCreate(ROOM_NAMES.building, {}, BuildingStateSchema);
  opened.push(room);
  await until(() => room.state.lobbyWhiteboardVersion === 5, "lobby version");
  rooms.building.setLobbyWhiteboard(6);
  await until(() => room.state.lobbyWhiteboardVersion === 6, "lobby version bump");
  expect(LOBBY_WHITEBOARD_ID).toBe("lobby");
});
