/**
 * End-to-end across auth and rooms: register through the HTTP API, then join
 * the BuildingRoom with a real `@colyseus/sdk` client carrying only the
 * session cookie. With the dev header auth off, a join without a session is
 * refused.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client, type Room } from "@colyseus/sdk";
import { BuildingStateSchema, ROOM_NAMES } from "@regulus/protocol";
import {
  closeDatabase,
  type Db,
  MEMORY_DB_PATH,
  openDatabase,
  runMigrations,
} from "../db/index.ts";
import { createOfficeServer, type OfficeServer } from "../http/server.ts";
import { createLogger } from "../logging.ts";
import { createSessionRoomAuth, DEV_USER_HEADER } from "../rooms/auth.ts";
import { createRooms, type Rooms } from "../rooms/index.ts";
import { createAuth, type OfficeAuth } from "./auth.ts";
import { cookieHeaderFrom, mountAuthRoutes } from "./routes.ts";
import { PASSWORD, TEST_SECRET } from "./test-helpers.ts";

type BuildingState = InstanceType<typeof BuildingStateSchema>;

const logger = createLogger({ level: "silent" });
let db: Db;
let rooms: Rooms;
let server: OfficeServer;
let auth: OfficeAuth | undefined;
const opened: Room<unknown, BuildingState>[] = [];

const client = (headers: Record<string, string> = {}) =>
  new Client(String(server.url).replace(/\/$/, ""), { headers });

async function waitFor(check: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

beforeAll(async () => {
  db = openDatabase({ path: MEMORY_DB_PATH });
  runMigrations(db);
  // The auth instance needs the server's URL, which exists only after the server
  // is created with the rooms attached; the lookup defers to it lazily.
  rooms = createRooms({
    db,
    logger,
    auth: createSessionRoomAuth({
      getSessionFromRequest: (request) =>
        auth?.getSessionFromRequest(request) ?? Promise.resolve(null),
    }),
    publicUrl: "http://127.0.0.1",
    production: false,
  });
  server = createOfficeServer({
    config: { port: 0, host: "127.0.0.1", webDist: "/nonexistent" },
    logger,
    version: "test",
    attach: rooms.transport.attachment,
  });
  auth = createAuth({
    db,
    logger,
    config: {
      betterAuthSecret: TEST_SECRET,
      publicUrl: String(server.url),
      githubOAuth: undefined,
      openSignup: false,
    },
  });
  mountAuthRoutes(server.router, auth);
  await rooms.transport.listen();
});

afterAll(async () => {
  await Promise.all(opened.splice(0).map((room) => Promise.race([room.leave(), Bun.sleep(200)])));
  await rooms.transport.shutdown();
  await server.stop(true);
  closeDatabase(db);
});

describe("room join with the session cookie", () => {
  test("a registered human joins the building room; the presence carries the profile", async () => {
    const res = await fetch(new URL("/api/auth/sign-up/email", server.url), {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(server.url).origin },
      body: JSON.stringify({ email: "ada@example.com", password: PASSWORD, name: "Ada" }),
    });
    expect(res.status).toBe(200);
    const { user } = (await res.json()) as { user: { id: string } };
    const cookie = cookieHeaderFrom(res.headers);
    expect(cookie).toContain("office.session_token=");

    const room = await client({ cookie }).joinOrCreate<BuildingState>(
      ROOM_NAMES.building,
      {},
      BuildingStateSchema,
    );
    opened.push(room);
    await waitFor(() => room.state.humans.has(room.sessionId), "own presence");
    const presence = room.state.humans.get(room.sessionId);
    expect(presence?.userId).toBe(user.id);
    expect(presence?.displayName).toBe("Ada");
    expect(presence?.role).toBe("owner");
    expect(presence?.avatar.archetype).toBe("mastermind");
    expect(presence?.avatar.accessory).toBe("none");
  });

  test("without a session the join is refused, and the dev header is not honoured", async () => {
    await expect(client().joinOrCreate(ROOM_NAMES.building)).rejects.toThrow(/authentication/i);
    await expect(
      client({ [DEV_USER_HEADER]: JSON.stringify({ userId: "x", displayName: "X" }) }).joinOrCreate(
        ROOM_NAMES.building,
      ),
    ).rejects.toThrow(/authentication/i);
    await expect(
      client({ cookie: "office.session_token=forged" }).joinOrCreate(ROOM_NAMES.building),
    ).rejects.toThrow(/authentication/i);
  });
});
