/**
 * Per-viewer building state over real Colyseus connections (SPEC D26, D27;
 * #270). Three people are in the same BuildingRoom:
 *
 * - Mia sees every repo (rooms Alpha and Bravo on her own level, Charlie on
 *   the octo level).
 * - Gus is a guest with read access to Alpha only.
 * - Olga is the office owner and has no GitHub link.
 *
 * Gus must get Alpha, Bravo as a closed room (id and footprint, nothing
 * else) and no trace of Charlie or its level; Olga must get the lobby only.
 * The checks read what each client actually decoded off the wire.
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
  type CompoundState,
  EMPTY_COMPOUND,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  ROOM_NAMES,
  type UsageSummary,
} from "@regulus/protocol";
import { eq } from "drizzle-orm";
import type { CompoundSnapshot } from "../../compound/room-state.ts";
import { closeDatabase, type Db, openDatabase, runMigrations, schema } from "../../db/index.ts";
import { seedRoomAccess, seedRoomRepo } from "../../github/access/test-snapshot.ts";
import { createOfficeServer, type OfficeServer } from "../../http/server.ts";
import { createLogger } from "../../logging.ts";
import { createDevHeaderAuth, DEV_USER_HEADER } from "../auth.ts";
import { createRooms, type Rooms } from "../index.ts";

type BuildingState = InstanceType<typeof BuildingStateSchema>;
type BuildingRoom = Room<unknown, BuildingState>;

const logger = createLogger({ level: "silent" });
const COMPOUND: CompoundState = { ...EMPTY_COMPOUND, width: 64, depth: 64, version: 1 };
const A = "room-alpha";
const B = "room-bravo";
const C = "room-charlie";
/** Everything that names or counts Bravo and Charlie; none of it may reach Gus or Olga. */
const SECRETS = ["Bravo-secret", "Charlie-secret", "bravo-slug", "charlie-slug", "octo-corp"];

let dataDir: string;
let db: Db;
let rooms: Rooms;
let server: OfficeServer;
const opened: BuildingRoom[] = [];

const header = (userId: string, displayName: string, role = "member") =>
  JSON.stringify({ userId, displayName, role });
const MIA = header("u-mia", "Mia");
const GUS = header("u-gus", "Gus");
const OLGA = header("u-olga", "Olga", "owner");

async function joinAs(devUser: string): Promise<BuildingRoom> {
  const client = new Client(String(server.url).replace(/\/$/, ""), {
    headers: { [DEV_USER_HEADER]: devUser },
  });
  const room: BuildingRoom = await client.joinOrCreate<BuildingState>(
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

/** Two patch ticks: long enough for anything the server would send to have arrived. */
const settle = () => Bun.sleep(150);

const seen = (room: BuildingRoom) => room.state.toJSON() as unknown as Record<string, unknown>;
const keys = (room: BuildingRoom, field: "operations" | "closedRooms" | "levels") =>
  Object.keys(seen(room)[field] as object).sort();
const names = (room: BuildingRoom) =>
  Object.values(seen(room).humans as Record<string, { displayName: string }>)
    .map((h) => h.displayName)
    .sort();
const wire = (room: BuildingRoom) => JSON.stringify(seen(room));

const nextRejection = (room: BuildingRoom): Promise<CommandRejected> =>
  new Promise((resolve) => {
    const off = room.onMessage(COMMAND_REJECTED_MESSAGE, (msg: CommandRejected) => {
      off();
      resolve(msg);
    });
  });

function snapshot(roomIds: string[]): CompoundSnapshot {
  const level = (
    levelId: string,
    kind: "lobby" | "account" | "org",
    login: string,
    order: number,
  ) => ({ levelId, kind, login, name: login || "Lobby", order, state: COMPOUND }) as const;
  return {
    state: COMPOUND,
    rooms: new Map(
      roomIds.map((id, i) => [
        id,
        {
          gridX: 4 + i * 10,
          gridY: 20,
          width: 6,
          depth: 6,
          doorSide: "south" as const,
          doorX: 6 + i * 10,
          doorY: 26,
          buildState: "ready" as const,
          buildEndsAt: 0,
        },
      ]),
    ),
    levels: [
      level(LOBBY_LEVEL_ID, "lobby", "", 0),
      level("lv-mia", "account", "mia", 1),
      level("lv-octo", "org", "octo-corp", 2),
    ],
  };
}

function addRoom(id: string, name: string, slug: string, levelId: string, index: number): string {
  db.insert(schema.operations)
    .values({ id, name, slug, index, paletteId: "oak-sky", layoutTemplateId: "l2", levelId })
    .run();
  return seedRoomRepo(db, id, `${levelId === "lv-octo" ? "octo-corp" : "mia"}/${slug}`);
}

function addHenchman(id: string, operationId: string, repoId: string): void {
  db.insert(schema.agents)
    .values({
      id,
      operationId,
      repoId,
      deskSeatId: "d1s1",
      ownerUserId: "u-mia",
      provider: "claude-code",
      model: "m",
      profileId: "p",
      status: "working",
      workdir: "/nonexistent",
      taskTitle: `task in ${operationId}`,
    })
    .run();
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "270-viewers-"));
  db = openDatabase({ path: join(dataDir, "office.db") });
  runMigrations(db);
  for (const [id, name, role] of [
    ["u-mia", "Mia", "member"],
    ["u-gus", "Gus", "member"],
    ["u-olga", "Olga", "owner"],
  ] as const) {
    db.insert(schema.users)
      .values({ id, name, email: `${id}@example.com`, emailVerified: false })
      .run();
    db.insert(schema.userProfiles).values({ userId: id, displayName: name, role }).run();
  }
  db.insert(schema.levels)
    .values([
      { id: "lv-mia", kind: "account", login: "mia", name: "mia", position: 1 },
      { id: "lv-octo", kind: "org", login: "octo-corp", name: "octo-corp", position: 2 },
    ])
    .run();
  addRoom(A, "Alpha", "alpha", "lv-mia", 1);
  const bravo = addRoom(B, "Bravo-secret", "bravo-slug", "lv-mia", 2);
  const charlie = addRoom(C, "Charlie-secret", "charlie-slug", "lv-octo", 3);
  addHenchman("h-bravo", B, bravo);
  addHenchman("h-charlie", C, charlie);
  for (const id of [A, B, C]) seedRoomAccess(db, "u-mia", id, "admin");
  seedRoomAccess(db, "u-gus", A, "read");

  rooms = createRooms({
    db,
    logger,
    auth: createDevHeaderAuth({ NODE_ENV: "test" }),
    publicUrl: "https://office.example.com",
    production: false,
  });
  rooms.building.setCompound(snapshot([A, B, C]));
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

describe("per-viewer building state", () => {
  let mia: BuildingRoom;
  let gus: BuildingRoom;
  let olga: BuildingRoom;

  test("each person gets their own rooms, closed rooms and levels", async () => {
    mia = await joinAs(MIA);
    gus = await joinAs(GUS);
    olga = await joinAs(OLGA);
    await waitFor(() => keys(mia, "operations").length === 4, "Mia's rooms");
    await waitFor(() => keys(gus, "operations").length === 2, "Gus's rooms");
    await settle();

    expect(keys(mia, "operations")).toEqual([LOBBY_OPERATION_ID, A, B, C].sort());
    expect(keys(mia, "closedRooms")).toEqual([]);
    expect(keys(mia, "levels")).toEqual([LOBBY_LEVEL_ID, "lv-mia", "lv-octo"].sort());

    expect(keys(gus, "operations")).toEqual([LOBBY_OPERATION_ID, A].sort());
    expect(keys(gus, "closedRooms")).toEqual([B]);
    expect(keys(gus, "levels")).toEqual([LOBBY_LEVEL_ID, "lv-mia"].sort());

    // The office owner has no GitHub link: the lobby and nothing else.
    expect(keys(olga, "operations")).toEqual([LOBBY_OPERATION_ID]);
    expect(keys(olga, "closedRooms")).toEqual([]);
    expect(keys(olga, "levels")).toEqual([LOBBY_LEVEL_ID]);
  });

  test("a closed room is an id and a footprint; nothing else about it is on the wire", () => {
    const closed = (seen(gus).closedRooms as Record<string, object>)[B];
    expect(closed).toEqual({
      operationId: B,
      levelId: "lv-mia",
      gridX: 14,
      gridY: 20,
      width: 6,
      depth: 6,
      doorSide: "south",
      doorX: 16,
      doorY: 26,
      closed: true,
    });
    for (const secret of SECRETS) {
      expect(wire(gus)).not.toContain(secret);
      expect(wire(olga)).not.toContain(secret);
    }
    // Charlie is on a level Gus cannot reach: not even its id.
    expect(wire(gus)).not.toContain(C);
    expect(wire(gus)).not.toContain("lv-octo");
    for (const id of [A, B, C, "lv-mia", "lv-octo"]) expect(wire(olga)).not.toContain(id);
    // Mia, who may, does get the names and the counts.
    const bravo = (seen(mia).operations as Record<string, Record<string, unknown>>)[B];
    expect(bravo).toMatchObject({ name: "Bravo-secret", henchmenWorking: 1, henchmenTotal: 1 });
  });

  test("a closed room and an unreachable level cannot be entered, and are not named", async () => {
    for (const [who, payload, reason] of [
      [gus, { operationId: B }, `unknown operation ${B}`],
      [gus, { operationId: C }, `unknown operation ${C}`],
      [gus, { operationId: "no-such-room" }, "unknown operation no-such-room"],
      [gus, { operationId: LOBBY_OPERATION_ID, levelId: "lv-octo" }, "unknown level lv-octo"],
      [olga, { operationId: A }, `unknown operation ${A}`],
      [olga, { operationId: LOBBY_OPERATION_ID, levelId: "lv-mia" }, "unknown level lv-mia"],
    ] as const) {
      const rejected = nextRejection(who);
      who.send("operation.go", payload);
      expect((await rejected).reason).toBe(reason);
    }
    const self = (room: BuildingRoom) =>
      (seen(room).humans as Record<string, { operationId: string; levelId: string }>)[
        room.sessionId
      ];
    expect(self(gus)).toMatchObject({ operationId: LOBBY_OPERATION_ID, levelId: LOBBY_LEVEL_ID });
    expect(self(olga)).toMatchObject({ operationId: LOBBY_OPERATION_ID, levelId: LOBBY_LEVEL_ID });
  });

  test("people are seen only where the viewer can see", async () => {
    await waitFor(() => names(gus).length === 3, "everyone in the lobby");
    expect(names(olga)).toEqual(["Gus", "Mia", "Olga"]);

    // Mia walks into Bravo: closed to Gus and Olga, so she is gone for them.
    mia.send("operation.go", { operationId: B });
    await waitFor(() => !names(gus).includes("Mia"), "Mia to vanish for Gus");
    await waitFor(() => !names(olga).includes("Mia"), "Mia to vanish for Olga");
    mia.send("move", { x: 31, z: 43, heading: 1 });
    await settle();
    expect(wire(gus)).not.toContain("Mia");
    expect(wire(olga)).not.toContain("Mia");
    // The lobby's head count says nothing of Bravo; Bravo's own is not Gus's to see.
    expect(wire(gus)).not.toContain("Bravo-secret");

    // Into Alpha: Gus may enter it and sees her; Olga cannot reach the level.
    mia.send("operation.go", { operationId: A });
    await waitFor(() => names(gus).includes("Mia"), "Mia back for Gus");
    await settle();
    expect(names(olga)).toEqual(["Gus", "Olga"]);

    // On to the octo level's corridor: unreachable for both.
    mia.send("operation.go", { operationId: LOBBY_OPERATION_ID, levelId: "lv-octo" });
    await waitFor(() => !names(gus).includes("Mia"), "Mia to vanish again");
    await settle();
    expect(names(olga)).toEqual(["Gus", "Olga"]);
    expect(wire(gus)).not.toContain("lv-octo");

    mia.send("operation.go", { operationId: LOBBY_OPERATION_ID, levelId: LOBBY_LEVEL_ID });
    await waitFor(() => names(olga).includes("Mia"), "Mia back in the lobby");
  });

  test("live updates of a closed room stay with those who may see it", async () => {
    db.update(schema.operations)
      .set({ name: "Bravo-secret-renamed" })
      .where(eq(schema.operations.id, B))
      .run();
    db.update(schema.operations)
      .set({ name: "Charlie-secret-renamed", deskCount: 5 })
      .where(eq(schema.operations.id, C))
      .run();
    addHenchman("h-charlie-2", C, `repo-of-${C}`);
    await rooms.operationChanged(B);
    await rooms.operationChanged(C);
    const ops = (room: BuildingRoom) =>
      seen(room).operations as Record<string, Record<string, unknown>>;
    await waitFor(() => ops(mia)[C]?.henchmenTotal === 2, "Mia to see the update");
    expect(ops(mia)[B]?.name).toBe("Bravo-secret-renamed");
    await settle();
    for (const room of [gus, olga]) {
      expect(wire(room)).not.toContain("renamed");
      expect(wire(room)).not.toContain(C);
    }
    expect(keys(gus, "closedRooms")).toEqual([B]);

    // A new room on Mia's level: open for her, a closed footprint for Gus, nothing for Olga.
    addRoom("room-delta", "Delta-secret", "delta-slug", "lv-mia", 4);
    seedRoomAccess(db, "u-mia", "room-delta", "admin");
    rooms.building.setCompound(snapshot([A, B, C, "room-delta"]));
    await rooms.operationChanged("room-delta");
    await waitFor(() => keys(gus, "closedRooms").length === 2, "the new closed room");
    expect(keys(gus, "closedRooms")).toEqual([B, "room-delta"].sort());
    expect(keys(mia, "operations")).toContain("room-delta");
    expect(wire(gus)).not.toContain("Delta-secret");
    expect(wire(olga)).not.toContain("room-delta");
  });

  test("the usage leaderboard names only henchmen of rooms the viewer may enter", async () => {
    const row = (agentId: string, name: string) => ({
      agentId,
      name,
      ownerName: "Mia",
      provider: "claude-code" as const,
      tokens: 10,
    });
    const usage: UsageSummary & { henchmanRooms: Record<string, string> } = {
      todayInputTokens: 30,
      todayOutputTokens: 0,
      todayCacheTokens: 0,
      todayCostUsdEstimate: 0,
      officeKeysCostUsdEstimate: 0,
      activeHumans: 1,
      topHenchmen: [
        row("h-alpha", "Alpha-henchman"),
        row("h-bravo", "Bravo-secret-henchman"),
        row("h-charlie", "Charlie-secret-henchman"),
      ],
      henchmanRooms: { "h-alpha": A, "h-bravo": B, "h-charlie": C },
      dayStart: 1,
      observedAt: 2,
    };
    rooms.building.setUsage(usage);
    const top = (room: BuildingRoom) =>
      ((seen(room).usage as { topHenchmen?: { name: string }[] }).topHenchmen ?? []).map(
        (h) => h.name,
      );
    await waitFor(() => top(mia).length === 3, "Mia's leaderboard");
    await waitFor(() => top(gus).length === 1, "Gus's leaderboard");
    await settle();
    expect(top(gus)).toEqual(["Alpha-henchman"]);
    expect(top(olga)).toEqual([]);
    // The office totals are everyone's; the room map never leaves the server.
    expect((seen(olga).usage as { todayInputTokens: number }).todayInputTokens).toBe(30);
    for (const room of [mia, gus, olga]) expect(wire(room)).not.toContain("henchmanRooms");
  });

  test("chat does not say which room the sender stood in", async () => {
    mia.send("operation.go", { operationId: B });
    await waitFor(() => !names(gus).includes("Mia"), "Mia in Bravo");
    mia.send("chat", { text: "hello from somewhere" });
    const chat = (room: BuildingRoom) => seen(room).chat as { text: string; operationId: string }[];
    await waitFor(() => chat(gus).some((m) => m.text === "hello from somewhere"), "the chat line");
    expect(chat(gus).find((m) => m.text === "hello from somewhere")?.operationId).toBe("");
    expect(wire(gus)).not.toContain(`"operationId":"${B}","text"`);
    mia.send("operation.go", { operationId: LOBBY_OPERATION_ID, levelId: LOBBY_LEVEL_ID });
  });

  test("gained access opens the room and the level at once; lost access closes them", async () => {
    seedRoomAccess(db, "u-gus", C, "read");
    rooms.building.accessChanged("u-gus");
    await waitFor(() => keys(gus, "operations").includes(C), "Charlie to open for Gus");
    expect(keys(gus, "levels")).toEqual([LOBBY_LEVEL_ID, "lv-mia", "lv-octo"].sort());

    // Gus walks into Alpha, then loses it on GitHub.
    gus.send("operation.go", { operationId: A });
    const self = () =>
      (seen(gus).humans as Record<string, { operationId: string; levelId: string }>)[gus.sessionId];
    await waitFor(() => self()?.operationId === A, "Gus in Alpha");
    seedRoomAccess(db, "u-gus", A, "none");
    rooms.building.accessChanged("u-gus");
    await waitFor(() => !keys(gus, "operations").includes(A), "Alpha to close for Gus");
    await waitFor(() => self()?.levelId === LOBBY_LEVEL_ID, "Gus back in the lobby");
    // His last room on Mia's level is gone, so the level is too, closed rooms included.
    expect(keys(gus, "levels")).toEqual([LOBBY_LEVEL_ID, "lv-octo"].sort());
    expect(keys(gus, "closedRooms")).toEqual([]);
    expect(self()?.operationId).toBe(LOBBY_OPERATION_ID);
    await settle();
    expect(wire(gus)).not.toContain(A);
    expect(wire(gus)).not.toContain("lv-mia");
    // Nobody else's view moved.
    expect(keys(mia, "operations")).toContain(A);
    expect(keys(olga, "operations")).toEqual([LOBBY_OPERATION_ID]);
  });

  test("a late joiner gets only their own view in the first full state", async () => {
    const late = await joinAs(header("u-olga", "Olga again", "owner"));
    await waitFor(() => keys(late, "operations").length === 1, "the late join's state");
    await settle();
    expect(keys(late, "operations")).toEqual([LOBBY_OPERATION_ID]);
    expect(keys(late, "levels")).toEqual([LOBBY_LEVEL_ID]);
    for (const secret of [...SECRETS, A, B, C, "lv-mia", "lv-octo", "renamed"]) {
      expect(wire(late)).not.toContain(secret);
    }
  });
});
