/**
 * The blast door over the wire (#188): a press by one human opens it for
 * every client, a press from too far away is refused, the door shuts on
 * its own after the open time, and each accepted press lands in the audit
 * log.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import {
  BuildingStateSchema,
  blastDoorButtons,
  COMMAND_REJECTED_MESSAGE,
  type CommandRejected,
  type CompoundState,
  EMPTY_COMPOUND,
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

const OPEN_MS = 4000;
const logger = createLogger({ level: "silent" });
const compound: CompoundState = {
  ...EMPTY_COMPOUND,
  width: 64,
  depth: 64,
  outsideDepth: 6,
  version: 7,
  blastDoorX: 30,
  blastDoorY: 64,
  blastDoorWidth: 4,
};
const [button] = blastDoorButtons(compound);
let dataDir: string;
let db: Db;
let rooms: Rooms;
let server: OfficeServer;
const opened: BuildingRoom[] = [];

const people = [
  { userId: "u-olga", displayName: "Olga", role: "owner" },
  { userId: "u-vic", displayName: "Vic", role: "viewer" },
];

async function joinAs(person: (typeof people)[number]): Promise<BuildingRoom> {
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

const nextRejection = (room: BuildingRoom): Promise<CommandRejected> =>
  new Promise((resolve) => {
    const off = room.onMessage(COMMAND_REJECTED_MESSAGE, (msg: CommandRejected) => {
      off();
      resolve(msg);
    });
  });

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "office-blast-door-"));
  db = openDatabase({ path: join(dataDir, "office.db") });
  runMigrations(db);
  for (const p of people) {
    db.insert(schema.users)
      .values({ id: p.userId, name: p.displayName, email: `${p.userId}@x.test` })
      .run();
  }
  rooms = createRooms({
    db,
    logger,
    auth: createDevHeaderAuth({ NODE_ENV: "test" }),
    publicUrl: "https://office.example.com",
    production: false,
    blastDoorMs: OPEN_MS,
  });
  rooms.building.setCompound({ state: compound, rooms: new Map() });
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

describe("blast door over the wire", () => {
  test("a press at the button opens it for everyone; it shuts by itself; presses are audited", async () => {
    const [olgaInfo, vicInfo] = people;
    if (!olgaInfo || !vicInfo || !button) throw new Error("setup");
    const olga = await joinAs(olgaInfo);
    const vic = await joinAs(vicInfo);
    await waitFor(() => vic.state.humans.size === 2, "both humans");
    expect(vic.state.blastDoor.phase).toBe("closed");

    // From the middle of nowhere: refused, nothing changes.
    const refused = nextRejection(vic);
    vic.send("blast_door.press", {});
    expect(await refused).toEqual({
      type: "blast_door.press",
      reason: "Walk up to the blast door button to press it.",
    });

    // A viewer at the lobby button may press it too ("anyone in the lobby").
    vic.send("move", { x: button.stand.x, z: button.stand.z, heading: 0 });
    await waitFor(
      () => vic.state.humans.get(vic.sessionId)?.position.x === button.stand.x,
      "Vic at the button",
    );
    vic.send("blast_door.press", {});
    await waitFor(() => olga.state.blastDoor.phase === "open", "Olga sees it open");
    expect(olga.state.blastDoor.openedBy).toBe("Vic");
    expect(olga.state.blastDoor.closesAt - olga.state.blastDoor.openedAt).toBe(OPEN_MS);

    // A second press at once is refused (rate limit).
    const limited = nextRejection(vic);
    vic.send("blast_door.press", {});
    expect((await limited).reason).toMatch(/moving|wait/);

    await waitFor(() => olga.state.blastDoor.phase === "closing", "the warning", OPEN_MS);
    await waitFor(() => olga.state.blastDoor.phase === "closed", "shut again", OPEN_MS);
    expect(vic.state.blastDoor.closesAt).toBe(0);

    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "compound.blast_door_open"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: "u-vic", targetKind: "compound" });
  });
});
