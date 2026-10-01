/**
 * The jukebox over the wire (#47): clock pings are answered to the sender,
 * a queued track reaches every client with the same playhead, refusals come
 * back as `command.rejected`, and the state survives a new room.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import {
  BuildingStateSchema,
  CLOCK_PONG_MESSAGE,
  type ClockPong,
  COMMAND_REJECTED_MESSAGE,
  type CommandRejected,
  JUKEBOX_LIMITS,
  JukeboxStateSchema,
  ROOM_NAMES,
} from "@regulus/protocol";
import { closeDatabase, type Db, openDatabase, runMigrations, schema } from "../db/index.ts";
import { createOfficeServer, type OfficeServer } from "../http/server.ts";
import { createLogger } from "../logging.ts";
import { createDevHeaderAuth, DEV_USER_HEADER } from "../rooms/auth.ts";
import { createRooms, type Rooms } from "../rooms/index.ts";
import { createJukebox, type Jukebox } from "./setup.ts";

type BuildingState = InstanceType<typeof BuildingStateSchema>;
type BuildingRoom = Room<unknown, BuildingState>;

const logger = createLogger({ level: "silent" });
let dataDir: string;
let db: Db;
let jukebox: Jukebox;
let rooms: Rooms;
let server: OfficeServer;
const opened: BuildingRoom[] = [];

const mia = { userId: "u-mia", displayName: "Mia", role: "member" };
const ben = { userId: "u-ben", displayName: "Ben", role: "member" };

async function joinAs(person: typeof mia): Promise<BuildingRoom> {
  const client = new Client(String(server.url).replace(/\/$/, ""), {
    headers: { [DEV_USER_HEADER]: JSON.stringify(person) },
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

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "office-jukebox-wire-"));
  db = openDatabase({ path: join(dataDir, "office.db") });
  runMigrations(db);
  for (const p of [mia, ben]) {
    db.insert(schema.users)
      .values({ id: p.userId, name: p.displayName, email: `${p.userId}@x.test` })
      .run();
  }
  jukebox = createJukebox({ db, dataDir, logger });
  rooms = createRooms({
    db,
    logger,
    auth: createDevHeaderAuth({ NODE_ENV: "test" }),
    publicUrl: "https://office.example.com",
    production: false,
    jukebox: jukebox.player,
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

describe("jukebox over the wire", () => {
  test("a clock ping is answered to its sender with the server's time", async () => {
    const room = await joinAs(mia);
    const pong = new Promise<ClockPong>((resolve) => {
      const off = room.onMessage(CLOCK_PONG_MESSAGE, (msg: ClockPong) => {
        off();
        resolve(msg);
      });
    });
    const t0 = Date.now();
    room.send("clock.ping", { id: 7, t0 });
    const msg = await pong;
    expect(msg.id).toBe(7);
    expect(msg.t0).toBe(t0);
    expect(msg.t1).toBeGreaterThanOrEqual(t0);
    expect(msg.t2).toBeGreaterThanOrEqual(msg.t1);
    expect(msg.t2).toBeLessThanOrEqual(Date.now());
  });

  test("a queued track reaches everyone; someone else's skip is refused; the adder's is not", async () => {
    const a = opened[0] ?? (await joinAs(mia));
    const b = await joinAs(ben);
    await waitFor(() => b.state.humans.size === 2, "both humans");
    a.send("jukebox.enqueue", { trackId: "bundled:spy-glass" });
    await waitFor(() => b.state.jukebox.current.trackId === "bundled:spy-glass", "Ben sees it");
    expect(b.state.jukebox.playing).toBe(true);
    expect(b.state.jukebox.current.addedByName).toBe("Mia");
    expect(b.state.jukebox.startedAtServerMs).toBe(a.state.jukebox.startedAtServerMs);
    expect(Math.abs(Date.now() - b.state.jukebox.startedAtServerMs)).toBeLessThan(2_000);

    const refused = new Promise<CommandRejected>((resolve) => {
      const off = b.onMessage(COMMAND_REJECTED_MESSAGE, (msg: CommandRejected) => {
        off();
        resolve(msg);
      });
    });
    b.send("jukebox.skip", {});
    expect((await refused).type).toBe("jukebox.skip");
    expect(a.state.jukebox.current.trackId).toBe("bundled:spy-glass");

    await Bun.sleep(JUKEBOX_LIMITS.commandIntervalMs);
    a.send("jukebox.skip", {});
    await waitFor(() => b.state.jukebox.current.entryId === "", "the jukebox stops");
  });

  test("the state is saved: a new player picks up the queue", async () => {
    const [a] = opened;
    if (!a) throw new Error("setup");
    await Bun.sleep(300);
    a.send("jukebox.enqueue", { trackId: "bundled:covert-affair" });
    await waitFor(() => a.state.jukebox.current.trackId !== "", "playing again");
    const fresh = new JukeboxStateSchema();
    createJukebox({ db, dataDir, logger }).player.restore(fresh);
    expect(fresh.current.trackId).toBe("bundled:covert-affair");
    expect(fresh.startedAtServerMs).toBe(a.state.jukebox.startedAtServerMs);
  });
});
