/**
 * End-to-end: boots the office server on port 0 with the Colyseus transport,
 * joins with real `@colyseus/sdk` clients through the dev auth header and
 * checks presence, move relay + rate limit, chat persistence/replay,
 * operations, emotes and the origin check.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import {
  BuildingStateSchema,
  CHAT_BURST,
  type ChatMessage,
  COMMAND_REJECTED_MESSAGE,
  type CommandRejected,
  type CompoundState,
  DEFAULT_GENIUS_LOOK,
  EMPTY_COMPOUND,
  type GeniusLookValue,
  HOLDING_LEVEL_ID,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  ROOM_NAMES,
  seatKey,
} from "@regulus/protocol";
import { specialRoomSeats } from "@regulus/room-layout";
import { eq } from "drizzle-orm";
import { closeDatabase, type Db, openDatabase, runMigrations, schema } from "../../db/index.ts";
import { seedRoomMember, seedRoomRepo } from "../../github/access/test-snapshot.ts";
import { createOfficeServer, type OfficeServer } from "../../http/server.ts";
import { createLogger } from "../../logging.ts";
import { createDevHeaderAuth, DEV_USER_HEADER } from "../auth.ts";
import { CHAT_REPLAY, DrizzleChatStore } from "../chat/store.ts";
import { createRooms, type Rooms } from "../index.ts";
import { WORLD_HALF_EXTENT } from "./commands.ts";

type BuildingState = InstanceType<typeof BuildingStateSchema>;
type BuildingRoom = Room<unknown, BuildingState>;

const logger = createLogger({ level: "silent" });
/** A published compound with just the lobby (12×8 tiles), for the seat checks. */
const LOBBY_ROOM = { gridX: 26, gridY: 56, width: 12, depth: 8 };
const COMPOUND: CompoundState = {
  ...EMPTY_COMPOUND,
  width: 64,
  depth: 64,
  version: 3,
  specialRooms: [{ kind: "lobby", ...LOBBY_ROOM, doorSide: "north", doorX: 31, doorY: 56 }],
};
const SOFA_KEY = seatKey(LOBBY_OPERATION_ID, "sofa-2");
const SOFA = (() => {
  const m = COMPOUND.tileMetres;
  const seat = specialRoomSeats("lobby", LOBBY_ROOM.width * m, LOBBY_ROOM.depth * m).find(
    (s) => s.id === "sofa-2",
  );
  if (!seat) throw new Error("no sofa");
  return { x: LOBBY_ROOM.gridX * m + seat.pose.x, z: LOBBY_ROOM.gridY * m + seat.pose.z };
})();
let dataDir: string;
let db: Db;
let rooms: Rooms;
let server: OfficeServer;
let operationId: string;
const opened: BuildingRoom[] = [];

const user = (userId: string, displayName: string, role = "member") =>
  JSON.stringify({ userId, displayName, role });

/**
 * A dev-header user who is also a row in `users`, so their GitHub access to the
 * project room can be seeded (#270): `access` is what their account has on its repo.
 */
function person(
  userId: string,
  displayName: string,
  role: string,
  access: "view" | "spawn" | "manage" | null,
): string {
  db.insert(schema.users)
    .values({ id: userId, name: displayName, email: `${userId}@example.com` })
    .onConflictDoNothing()
    .run();
  seedRoomMember(db, userId, operationId, access);
  return user(userId, displayName, role);
}

function client(devUser?: string): Client {
  return new Client(String(server.url).replace(/\/$/, ""), {
    headers: devUser ? { [DEV_USER_HEADER]: devUser } : {},
  });
}

async function joinAs(devUser: string): Promise<BuildingRoom> {
  const room: BuildingRoom = await client(devUser).joinOrCreate<BuildingState>(
    ROOM_NAMES.building,
    {},
    BuildingStateSchema,
  );
  opened.push(room);
  return room;
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
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
  dataDir = await mkdtemp(join(tmpdir(), "office-rooms-"));
  db = openDatabase({ path: join(dataDir, "office.db") });
  runMigrations(db);
  const [operation] = await db
    .insert(schema.operations)
    .values({
      name: "Regulus",
      slug: "regulus",
      index: 1,
      paletteId: "oak-sky",
      layoutTemplateId: "l2",
    })
    .returning();
  if (!operation) throw new Error("seed failed");
  operationId = operation.id;
  // The project room has a repo, so it opens with GitHub access only (#270).
  seedRoomRepo(db, operationId);
  // Seed more history than the replay window to prove the window is enforced.
  const store = new DrizzleChatStore(db);
  for (let n = 1; n <= CHAT_REPLAY + 10; n++) {
    const line: ChatMessage = {
      id: `seed-${String(n).padStart(3, "0")}`,
      userId: "seed",
      displayName: "Seed",
      operationId: LOBBY_OPERATION_ID,
      text: `seed ${n}`,
      ts: 1_700_000_000_000 + n,
    };
    await store.append(line);
  }

  rooms = createRooms({
    db,
    logger,
    auth: createDevHeaderAuth({ NODE_ENV: "test" }),
    publicUrl: "https://office.example.com",
    production: false,
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
  // `leave()` on a room whose socket already closed never settles; cap the wait.
  await Promise.all(opened.splice(0).map((room) => Promise.race([room.leave(), Bun.sleep(200)])));
  await rooms.transport.shutdown();
  await server.stop(true);
  closeDatabase(db);
  await rm(dataDir, { recursive: true, force: true });
});

describe("BuildingRoom over the wire", () => {
  test("joining without a user is rejected", async () => {
    await expect(client().joinOrCreate(ROOM_NAMES.building)).rejects.toThrow(/authentication/i);
  });

  test("two humans see each other; a move is relayed within a patch", async () => {
    const ada = await joinAs(user("u-ada", "Ada", "owner"));
    const bob = await joinAs(user("u-bob", "Bob"));
    await waitFor(() => bob.state.humans.size === 2, "both humans in Bob's state");

    const adaSeenByBob = bob.state.humans.get(ada.sessionId);
    expect(adaSeenByBob).toMatchObject({
      userId: "u-ada",
      displayName: "Ada",
      role: "owner",
      operationId: LOBBY_OPERATION_ID,
      animation: "idle",
    });
    expect(bob.state.operations.get(LOBBY_OPERATION_ID)?.humansPresent).toBe(2);

    ada.send("move", { x: 3.5, z: -1.25, heading: 0.5 });
    await waitFor(
      () => bob.state.humans.get(ada.sessionId)?.position.x === 3.5,
      "Bob sees Ada move",
    );
    expect(bob.state.humans.get(ada.sessionId)?.position).toMatchObject({ x: 3.5, z: -1.25 });
    expect(bob.state.humans.get(ada.sessionId)?.animation).toBe("walk");
    await waitFor(() => bob.state.humans.get(ada.sessionId)?.animation === "idle", "Ada goes idle");
  });

  test("moves above 20 Hz are dropped, invalid moves are rejected", async () => {
    const ada = await joinAs(user("u-ada2", "Ada"));
    await waitFor(() => ada.state.humans.has(ada.sessionId), "own presence");
    await Bun.sleep(60);
    for (let i = 1; i <= 10; i++) ada.send("move", { x: 100 + i, z: 0, heading: 0 });
    await waitFor(
      () => ada.state.humans.get(ada.sessionId)?.position.x === 101,
      "first move applied",
    );
    await Bun.sleep(150);
    expect(ada.state.humans.get(ada.sessionId)?.position.x).toBe(101);

    const rejected = nextRejection(ada);
    ada.send("move", { x: WORLD_HALF_EXTENT + 1, z: 0, heading: 0 });
    expect(await rejected).toEqual({ type: "move", reason: "invalid move: out of bounds" });

    const rejectedNaN = nextRejection(ada);
    ada.send("move", { x: Number.NaN, z: 0, heading: 0 });
    expect((await rejectedNaN).reason).toMatch(/^invalid move: x: /);
    expect(ada.state.humans.get(ada.sessionId)?.position.x).toBe(101);
  });

  test("chat is broadcast, persisted (last 1000) and the last 50 replayed on join", async () => {
    const ada = await joinAs(user("u-ada3", "Ada"));
    await waitFor(() => ada.state.chat.length === CHAT_REPLAY, "seeded replay window");
    expect(ada.state.chat.at(0)?.text).toBe("seed 11");
    expect(ada.state.chat.at(-1)?.text).toBe(`seed ${CHAT_REPLAY + 10}`);

    const bob = await joinAs(user("u-bob3", "Bob"));
    ada.send("chat", { text: "  hello office  " });
    await waitFor(() => bob.state.chat.at(-1)?.text === "hello office", "Bob receives chat");
    // Lines in the state do not say which room they were written in (#270).
    expect(bob.state.chat.at(-1)).toMatchObject({
      userId: "u-ada3",
      displayName: "Ada",
      operationId: "",
    });
    expect(bob.state.chat.length).toBe(CHAT_REPLAY);

    const persisted = await new DrizzleChatStore(db).recent(1);
    expect(persisted[0]).toMatchObject({ userId: "u-ada3", text: "hello office" });

    await ada.leave();
    await bob.leave();
    const again = await joinAs(user("u-ada3", "Ada"));
    await waitFor(() => again.state.chat.length === CHAT_REPLAY, "replay after rejoin");
    expect(again.state.chat.at(-1)?.text).toBe("hello office");

    const empty = nextRejection(again);
    again.send("chat", { text: "   " });
    expect((await empty).type).toBe("chat");
  });

  test("operations list the lobby and database operations; operation.go moves presence", async () => {
    // A room opens with the person's own GitHub access to its repo (#270).
    const ada = await joinAs(person("u-ada4", "Ada", "member", "spawn"));
    await waitFor(() => ada.state.operations.size === 2, "operations synced");
    expect(ada.state.operations.get(operationId)).toMatchObject({
      name: "Regulus",
      slug: "regulus",
      index: 1,
      henchmenWorking: 0,
      henchmenTotal: 0,
      humansPresent: 0,
      deskCount: 1,
      decorStyle: "ops_room",
    });

    ada.send("operation.go", { operationId, mode: "teleport" });
    await waitFor(
      () => ada.state.humans.get(ada.sessionId)?.operationId === operationId,
      "moved operations",
    );
    expect(ada.state.operations.get(operationId)?.humansPresent).toBe(1);

    const rejected = nextRejection(ada);
    ada.send("operation.go", { operationId: "nope" });
    expect((await rejected).reason).toBe("unknown operation nope");
  });

  test("an office admin without GitHub access gets the lobby only (#270)", async () => {
    const inside = await joinAs(person("u-ada10", "Ada", "member", "view"));
    const ops = await joinAs(person("u-ops10", "Ops", "admin", null));
    await waitFor(() => inside.state.operations.size === 2, "the room for its member");
    inside.send("operation.go", { operationId, mode: "teleport" });
    await waitFor(
      () => inside.state.humans.get(inside.sessionId)?.operationId === operationId,
      "Ada in the room",
    );
    await waitFor(() => ops.state.humans.has(ops.sessionId), "own presence");
    await Bun.sleep(100);
    expect([...ops.state.operations.keys()]).toEqual([LOBBY_OPERATION_ID]);
    expect(ops.state.closedRooms.size).toBe(0);
    expect([...ops.state.levels.keys()].filter((id) => id !== LOBBY_LEVEL_ID)).toEqual([]);
    // Nobody inside a room closed to them is shown, and the refusal names nothing.
    expect(ops.state.humans.has(inside.sessionId)).toBe(false);
    const rejected = nextRejection(ops);
    ops.send("operation.go", { operationId, mode: "teleport" });
    expect((await rejected).reason).toBe(`unknown operation ${operationId}`);
    expect(ops.state.humans.get(ops.sessionId)?.operationId).toBe(LOBBY_OPERATION_ID);
  });

  test("emote and sit drive the animation state; a seat holds one human (#49)", async () => {
    rooms.building.setCompound({ state: COMPOUND, rooms: new Map() });
    const ada = await joinAs(user("u-ada5", "Ada"));
    const bob = await joinAs(user("u-bob5", "Bob"));
    await waitFor(() => bob.state.humans.has(ada.sessionId), "Ada visible");
    ada.send("emote", { emote: "thumbs_up" });
    await waitFor(
      () => bob.state.humans.get(ada.sessionId)?.animation === "thumbs_up",
      "Bob sees the emote",
    );
    const tooSoon = nextRejection(ada);
    ada.send("emote", { emote: "clap" });
    expect(await tooSoon).toEqual({ type: "emote", reason: "one emote at a time" });

    // Too far from the sofa: refused. Walk up, then both ask for the same seat at once.
    const far = nextRejection(ada);
    ada.send("sit", { seatId: SOFA_KEY });
    expect((await far).reason).toMatch(/too far/);
    ada.send("move", { x: SOFA.x, z: SOFA.z - 1, heading: 0 });
    bob.send("move", { x: SOFA.x + 0.5, z: SOFA.z - 1, heading: 0 });
    await waitFor(
      () => bob.state.humans.get(ada.sessionId)?.position.z === SOFA.z - 1,
      "Ada at the sofa",
    );
    await Bun.sleep(80);
    const bobRefused = nextRejection(bob);
    ada.send("sit", { seatId: SOFA_KEY });
    bob.send("sit", { seatId: SOFA_KEY });
    expect(await bobRefused).toEqual({ type: "sit", reason: "someone is already sitting there" });
    await waitFor(() => bob.state.humans.get(ada.sessionId)?.seatId === SOFA_KEY, "Ada seated");
    expect(bob.state.humans.get(bob.sessionId)?.seatId).toBe("");
    expect(bob.state.humans.get(ada.sessionId)?.animation).toBe("sit_idle");

    // Turning in the seat keeps it; walking off stands up and frees it for Bob.
    await Bun.sleep(60);
    ada.send("move", { x: SOFA.x, z: SOFA.z - 1, heading: 1 });
    await Bun.sleep(120);
    expect(bob.state.humans.get(ada.sessionId)?.seatId).toBe(SOFA_KEY);
    ada.send("move", { x: SOFA.x, z: SOFA.z - 2, heading: 1 });
    await waitFor(() => bob.state.humans.get(ada.sessionId)?.seatId === "", "Ada stood up");
    bob.send("sit", { seatId: SOFA_KEY });
    await waitFor(() => bob.state.humans.get(bob.sessionId)?.seatId === SOFA_KEY, "Bob seated");
    bob.send("sit", { seatId: null });
    await waitFor(() => bob.state.humans.get(bob.sessionId)?.animation === "idle", "stood up");

    // A desk seat is a henchman's, never a human's.
    const desk = nextRejection(bob);
    bob.send("sit", { seatId: `${LOBBY_OPERATION_ID}/d1s1` });
    expect((await desk).reason).toBe(`no seat ${LOBBY_OPERATION_ID}/d1s1`);
  });

  test("doing is published; chat floods are refused (#49)", async () => {
    const ada = await joinAs(user("u-ada9", "Ada", "admin"));
    const bob = await joinAs(user("u-bob9", "Bob"));
    await waitFor(() => bob.state.humans.has(ada.sessionId), "Ada visible");
    ada.send("doing", { doing: "  at the boards " });
    await waitFor(
      () => bob.state.humans.get(ada.sessionId)?.doing === "at the boards",
      "Bob sees what Ada is doing",
    );
    const flood = nextRejection(ada);
    for (let i = 0; i <= CHAT_BURST; i++) ada.send("chat", { text: `line ${i}` });
    expect((await flood).reason).toMatch(/too fast/);
    await waitFor(() => bob.state.chat.at(-1)?.text === `line ${CHAT_BURST - 1}`, "the burst");
  });

  test("agent.* commands are validated but not handled here", async () => {
    const ada = await joinAs(user("u-ada6", "Ada"));
    const rejected = nextRejection(ada);
    ada.send("agent.stop", { agentId: "a1" });
    expect((await rejected).reason).toBe("not handled by the building room");
  });

  test("cross-origin matchmaking and upgrades are refused", async () => {
    const res = await fetch(new URL("/matchmake/joinOrCreate/building", server.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        [DEV_USER_HEADER]: user("x", "X"),
      },
      body: "{}",
    });
    expect(res.status).toBe(403);

    const ok = await fetch(new URL("/matchmake/joinOrCreate/building", server.url), {
      method: "OPTIONS",
      headers: { origin: "https://office.example.com" },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://office.example.com");

    const wsUrl = new URL("/proc/room?sessionId=abc", server.url);
    wsUrl.protocol = "ws:";
    // Bun accepts `{ headers }` here at runtime; its types only list protocols.
    const wsOptions = { headers: { origin: "https://evil.example" } } as unknown as string[];
    const closed = await new Promise<number>((resolve) => {
      const ws = new WebSocket(wsUrl, wsOptions);
      ws.onclose = (e) => resolve(e.code);
      ws.onerror = () => {};
    });
    expect(closed).not.toBe(1000);
  });

  test("another human sees the chosen genius, and a change in settings at once (#185)", async () => {
    const diva: GeniusLookValue = {
      ...DEFAULT_GENIUS_LOOK,
      archetype: "diva",
      outfit: "plum",
      accessory: "tiara",
    };
    const ada = await joinAs(
      JSON.stringify({ userId: "u-ada8", displayName: "Ada", avatar: diva }),
    );
    const bob = await joinAs(user("u-bob8", "Bob"));
    await waitFor(() => bob.state.humans.has(ada.sessionId), "Ada visible");
    expect(bob.state.humans.get(ada.sessionId)?.avatar.toJSON()).toEqual(diva);
    expect(bob.state.humans.get(bob.sessionId)?.avatar.archetype).toBe("mastermind");

    const general: GeniusLookValue = { ...diva, archetype: "general", accessory: "medals" };
    rooms.building.setAvatar("u-ada8", general);
    await waitFor(
      () => bob.state.humans.get(ada.sessionId)?.avatar.archetype === "general",
      "Bob sees Ada's new genius",
    );
    expect(bob.state.humans.get(ada.sessionId)?.avatar.toJSON()).toEqual(general);
    expect(bob.state.humans.get(bob.sessionId)?.avatar.archetype).toBe("mastermind");
  });

  test("leaving removes presence and updates counters", async () => {
    const ada = await joinAs(user("u-ada7", "Ada"));
    const bob = await joinAs(user("u-bob7", "Bob"));
    await waitFor(() => bob.state.humans.has(ada.sessionId), "Ada visible");
    const before = bob.state.operations.get(LOBBY_OPERATION_ID)?.humansPresent ?? 0;
    await ada.leave();
    await waitFor(() => !bob.state.humans.has(ada.sessionId), "Ada gone");
    expect(bob.state.operations.get(LOBBY_OPERATION_ID)?.humansPresent).toBe(before - 1);
  });

  test("levels are published; presence is per level and follows the room (#268)", async () => {
    const level = (levelId: string, kind: "lobby" | "org", login: string, order: number) => ({
      levelId,
      kind,
      login,
      name: login || "Lobby",
      order,
      state: { ...COMPOUND, version: 10 + order },
    });
    rooms.building.setCompound({
      state: COMPOUND,
      rooms: new Map(),
      levels: [level(LOBBY_LEVEL_ID, "lobby", "", 0), level("lv-octo", "org", "octo", 1)],
    });
    // An admin: admins may enter every operation.
    const ada = await joinAs(user("u-ada9", "Ada", "admin"));
    const bob = await joinAs(user("u-bob9", "Bob"));
    await waitFor(() => bob.state.levels.size === 2, "levels published");
    expect(bob.state.levels.get("lv-octo")?.toJSON()).toMatchObject({
      levelId: "lv-octo",
      kind: "org",
      login: "octo",
      name: "octo",
      order: 1,
      compound: { width: 64, version: 11 },
    });
    const adaSeen = () => bob.state.humans.get(ada.sessionId);
    await waitFor(() => adaSeen() !== undefined, "Ada visible");
    expect(adaSeen()?.levelId).toBe(LOBBY_LEVEL_ID);

    // The lobby id is "in no project room": the level says where.
    ada.send("operation.go", { operationId: LOBBY_OPERATION_ID, levelId: "lv-octo" });
    await waitFor(() => adaSeen()?.levelId === "lv-octo", "Ada on octo's level");
    expect(adaSeen()?.operationId).toBe(LOBBY_OPERATION_ID);
    const unknown = nextRejection(ada);
    ada.send("operation.go", { operationId: LOBBY_OPERATION_ID, levelId: "lv-nope" });
    expect((await unknown).reason).toBe("unknown level lv-nope");

    // A project room is on one level: going there moves the human to it, whatever was named.
    ada.send("operation.go", { operationId, levelId: "lv-octo" });
    await waitFor(() => adaSeen()?.operationId === operationId, "Ada in the room");
    expect(adaSeen()?.levelId).toBe(bob.state.operations.get(operationId)?.levelId);
    expect(adaSeen()?.levelId).toBe(HOLDING_LEVEL_ID);
    // Without a level, stepping out of the room stays on its level.
    ada.send("operation.go", { operationId: LOBBY_OPERATION_ID });
    await waitFor(() => adaSeen()?.operationId === LOBBY_OPERATION_ID, "Ada out of the room");
    expect(adaSeen()?.levelId).toBe(HOLDING_LEVEL_ID);

    // A level that is no longer shown: whoever was on it is in the lobby.
    ada.send("operation.go", { operationId: LOBBY_OPERATION_ID, levelId: "lv-octo" });
    await waitFor(() => adaSeen()?.levelId === "lv-octo", "Ada back on octo's level");
    rooms.building.setCompound({ state: COMPOUND, rooms: new Map() });
    await waitFor(() => bob.state.levels.size === 1, "one level left");
    await waitFor(() => adaSeen()?.levelId === LOBBY_LEVEL_ID, "Ada in the lobby");
  });
});
