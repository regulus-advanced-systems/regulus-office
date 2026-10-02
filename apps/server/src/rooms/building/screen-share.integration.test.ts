/**
 * The lounge TV over the wire (#48): `screen.share.start|stop` through real
 * Colyseus clients, one sharer at a time, an admin takedown (audited), the
 * share ending with the sharer's presence, and the presence lookup the
 * media token route uses.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import {
  BuildingStateSchema,
  COMMAND_REJECTED_MESSAGE,
  type CommandRejected,
  ROOM_NAMES,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { closeDatabase, type Db, openDatabase, runMigrations, schema } from "../../db/index.ts";
import { createOfficeServer, type OfficeServer } from "../../http/server.ts";
import { createLogger } from "../../logging.ts";
import { createDevHeaderAuth, DEV_USER_HEADER } from "../auth.ts";
import { createRooms, type Rooms } from "../index.ts";

type BuildingState = InstanceType<typeof BuildingStateSchema>;
type BuildingRoom = Room<unknown, BuildingState>;

const logger = createLogger({ level: "silent" });
let dataDir: string;
let db: Db;
let rooms: Rooms;
let server: OfficeServer;
const opened: BuildingRoom[] = [];

const user = (userId: string, displayName: string, role = "member") =>
  JSON.stringify({ userId, displayName, role });

async function joinAs(devUser: string): Promise<BuildingRoom> {
  const c = new Client(String(server.url).replace(/\/$/, ""), {
    headers: { [DEV_USER_HEADER]: devUser },
  });
  const room: BuildingRoom = await c.joinOrCreate<BuildingState>(
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

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "office-screen-"));
  db = openDatabase({ path: join(dataDir, "office.db") });
  runMigrations(db);
  for (const [id, name] of [
    ["u-ada", "Ada"],
    ["u-bob", "Bob"],
    ["u-olga", "Olga"],
    ["u-vic", "Vic"],
  ] as const) {
    db.insert(schema.users)
      .values({ id, name, email: `${id}@x.test` })
      .run();
  }
  rooms = createRooms({
    db,
    logger,
    auth: createDevHeaderAuth({ NODE_ENV: "test" }),
    publicUrl: "https://office.example.com",
    production: false,
    mediaEnabled: true,
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

describe("lounge TV over the wire (#48)", () => {
  test("one sharer, an admin takedown, and the share ends when the sharer leaves", async () => {
    const ada = await joinAs(user("u-ada", "Ada"));
    const bob = await joinAs(user("u-bob", "Bob"));
    const olga = await joinAs(user("u-olga", "Olga", "admin"));
    const vic = await joinAs(user("u-vic", "Vic", "viewer"));
    await waitFor(() => bob.state.humans.size === 4, "everyone in");

    expect(rooms.building.presence(ada.sessionId)).toEqual({ userId: "u-ada" });
    expect(rooms.building.presence("nobody")).toBeNull();

    ada.send("screen.share.start", {});
    await waitFor(() => bob.state.humans.get(ada.sessionId)?.sharingScreen === true, "Ada shares");

    const busy = nextRejection(bob);
    bob.send("screen.share.start", {});
    expect((await busy).reason).toContain("Ada is sharing");

    const viewer = nextRejection(vic);
    vic.send("screen.share.start", {});
    expect((await viewer).type).toBe("screen.share.start");

    const notYours = nextRejection(bob);
    bob.send("screen.share.stop", { sessionId: ada.sessionId });
    expect((await notYours).type).toBe("screen.share.stop");

    olga.send("screen.share.stop", { sessionId: ada.sessionId });
    await waitFor(
      () => bob.state.humans.get(ada.sessionId)?.sharingScreen === false,
      "Olga stops Ada's share",
    );
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "media.screen_share_stop"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.userId).toBe("u-olga");
    expect(audit[0]?.targetId).toBe("u-ada");

    bob.send("screen.share.start", {});
    await waitFor(() => ada.state.humans.get(bob.sessionId)?.sharingScreen === true, "Bob shares");
    await bob.leave();
    await waitFor(() => !ada.state.humans.has(bob.sessionId), "Bob left");
    ada.send("screen.share.start", {});
    await waitFor(
      () => olga.state.humans.get(ada.sessionId)?.sharingScreen === true,
      "the TV is free again",
    );
  });
});
