/**
 * Coming back where you left, through the real BuildingRoom, the database and
 * the access gate (#262; D26, D27, D34): a person who leaves and joins again
 * (another device is just another join) stands on the same level, in the same
 * room, at the same spot; one who may no longer be there arrives at the lobby
 * spawn, is told nothing, and the remembered place is gone. Their personal
 * agent ends up beside them either way.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import {
  BuildingStateSchema,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  type OperationAccess,
  ROOM_NAMES,
} from "@regulus/protocol";
import {
  type CompoundRoomInput,
  coffeeMachineSpot,
  compoundStateOf,
  computeCompoundLayout,
  defaultCompoundSpec,
  doorApproach,
  landingSpec,
  roomSummaryPlacement,
} from "@regulus/room-layout";
import { eq } from "drizzle-orm";
import type { CompoundSnapshot } from "../../compound/room-state.ts";
import { closeDatabase, type Db, openDatabase, runMigrations, schema } from "../../db/index.ts";
import { seedRoomMember, seedRoomRepo } from "../../github/access/test-snapshot.ts";
import { createOfficeServer, type OfficeServer } from "../../http/server.ts";
import { createLogger } from "../../logging.ts";
import { AgentWorld, type WorldAgent } from "../../pm/world/index.ts";
import { createDevHeaderAuth, DEV_USER_HEADER } from "../auth.ts";
import { createRooms, type Rooms } from "../index.ts";
import type { ReturnPlace } from "./return-place.ts";

type BuildingState = InstanceType<typeof BuildingStateSchema>;
type BuildingRoom = Room<unknown, BuildingState>;

const LEVEL = "lv-octo-private";
const ALPHA = "room-alpha-private";
const BETA = "room-beta-private";
const GAMMA = "room-gamma-private";
const DELTA = "room-delta-private";

/** Four rooms on one organisation's level; tiles, door to the south. */
const PLACED: CompoundRoomInput[] = [
  { id: ALPHA, placement: { gridX: 8, gridY: 30, width: 8, depth: 8, doorSide: "south" } },
  { id: BETA, placement: { gridX: 40, gridY: 30, width: 8, depth: 8, doorSide: "south" } },
  { id: GAMMA, placement: { gridX: 8, gridY: 10, width: 8, depth: 8, doorSide: "south" } },
  { id: DELTA, placement: { gridX: 40, gridY: 10, width: 8, depth: 8, doorSide: "south" } },
];
/** The middle of a room, compound metres (2 m tiles). */
const middleOf = (id: string, rooms = PLACED) => {
  const p = rooms.find((r) => r.id === id)?.placement;
  if (!p) throw new Error(`no room ${id}`);
  return { x: (p.gridX + p.width / 2) * 2, z: (p.gridY + p.depth / 2) * 2 };
};
const spec = defaultCompoundSpec();
/** The middle of the lobby, where everyone without a place to return to arrives, facing north. */
const SPAWN = {
  x: (spec.lobby.x + spec.lobby.w / 2) * 2,
  z: (spec.lobby.y + spec.lobby.d / 2) * 2,
  heading: 0,
};

function snapshot(rooms: CompoundRoomInput[]): CompoundSnapshot {
  const lobby = compoundStateOf(computeCompoundLayout(spec, []));
  const layout = computeCompoundLayout(landingSpec(spec), rooms);
  if (layout.unreachable.length > 0) throw new Error("the test lair has a room without a corridor");
  return {
    state: lobby,
    rooms: new Map(
      layout.rooms.map((room) => [
        room.id,
        { ...roomSummaryPlacement(room), buildState: "ready" as const, buildEndsAt: 0 },
      ]),
    ),
    levels: [
      { levelId: LOBBY_LEVEL_ID, kind: "lobby", login: "", name: "Lobby", order: 0, state: lobby },
      {
        levelId: LEVEL,
        kind: "org",
        login: "octo",
        name: "Octo",
        order: 1,
        state: compoundStateOf(layout),
      },
    ],
  };
}

let dataDir: string;
let db: Db;
let rooms: Rooms;
let server: OfficeServer;
let agents: WorldAgent[] = [];
const opened: BuildingRoom[] = [];

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

/** A person with a row in `users`, and the rooms their GitHub access covers. */
function person(userId: string, access: Record<string, OperationAccess> = {}): void {
  db.insert(schema.users)
    .values({ id: userId, name: userId, email: `${userId}@example.com`, emailVerified: false })
    .run();
  db.insert(schema.userProfiles).values({ userId, displayName: userId, role: "member" }).run();
  for (const [operationId, level] of Object.entries(access))
    seedRoomMember(db, userId, operationId, level);
}

interface Joined {
  room: BuildingRoom;
  /** Every message the server sent this client, with its type. */
  messages: Array<{ type: string; payload: unknown }>;
  /** Their own presence in the first state that carried the lair. */
  first: ReturnPlace | null;
}

async function joinAs(userId: string): Promise<Joined> {
  const client = new Client(String(server.url).replace(/\/$/, ""), {
    headers: {
      [DEV_USER_HEADER]: JSON.stringify({ userId, displayName: userId, role: "member" }),
    },
  });
  const room: BuildingRoom = await client.joinOrCreate<BuildingState>(
    ROOM_NAMES.building,
    {},
    BuildingStateSchema,
  );
  opened.push(room);
  const messages: Joined["messages"] = [];
  room.onMessage("*", (type, payload) => messages.push({ type: String(type), payload }));
  const joined: Joined = { room, messages, first: null };
  const look = () => {
    if (joined.first || !(room.state.compound?.width > 0)) return;
    // The client spawns its player as soon as it has the lair: its own presence must be
    // in that same state, or it would start from the lobby and overwrite the place.
    const me = room.state.humans?.get(room.sessionId);
    joined.first = me ? placeOf(me) : { levelId: "", operationId: "", x: -1, z: -1, heading: 0 };
  };
  look();
  room.onStateChange(look);
  await waitFor(() => joined.first !== null, `${userId}'s first state`);
  return joined;
}

const placeOf = (h: {
  levelId: string;
  operationId: string;
  position: { x: number; z: number; heading: number };
}): ReturnPlace => ({
  levelId: h.levelId,
  operationId: h.operationId,
  x: h.position.x,
  z: h.position.z,
  heading: h.position.heading,
});

const stored = (userId: string) =>
  db.select().from(schema.userPlaces).where(eq(schema.userPlaces.userId, userId)).get();

/** Walk somewhere as a client does (the room, then the pose), then close the tab. */
async function standAndLeave(userId: string, place: ReturnPlace): Promise<void> {
  const { room } = await joinAs(userId);
  room.send("operation.go", {
    operationId: place.operationId,
    mode: "teleport",
    levelId: place.levelId,
  });
  room.send("move", { x: place.x, z: place.z, heading: place.heading });
  const me = () => room.state.humans.get(room.sessionId);
  await waitFor(
    () => me()?.position.x === place.x && me()?.operationId === place.operationId,
    `${userId} at the place`,
  );
  await Promise.race([room.leave(), Bun.sleep(500)]);
  await waitFor(() => stored(userId)?.x === place.x, `${userId}'s place to be remembered`);
}

const inRoom = (id: string, heading = 1.25): ReturnPlace => ({
  levelId: LEVEL,
  operationId: id,
  ...middleOf(id),
  heading,
});

const AT_SPAWN: ReturnPlace = {
  levelId: LOBBY_LEVEL_ID,
  operationId: LOBBY_OPERATION_ID,
  ...SPAWN,
};

/** Nothing this client was sent or holds names the room or the level. */
function expectNoTrace(joined: Joined, ...secrets: string[]): void {
  const wire = JSON.stringify(joined.room.state.toJSON());
  const said = JSON.stringify(joined.messages);
  for (const secret of secrets) {
    expect(wire).not.toContain(secret);
    expect(said).not.toContain(secret);
  }
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "office-return-"));
  db = openDatabase({ path: join(dataDir, "office.db") });
  runMigrations(db);
  const logger = createLogger({ level: "silent" });
  rooms = createRooms({
    db,
    logger,
    auth: createDevHeaderAuth({ NODE_ENV: "test" }),
    publicUrl: "https://office.example.com",
    production: false,
  });
  db.insert(schema.levels)
    .values({ id: LEVEL, kind: "org", login: "octo", name: "Octo", position: 1 })
    .run();
  for (const [index, { id }] of PLACED.entries()) {
    db.insert(schema.operations)
      .values({
        id,
        name: id,
        slug: id,
        index: index + 1,
        paletteId: "oak-sky",
        layoutTemplateId: "l2",
        levelId: LEVEL,
      })
      .run();
    seedRoomRepo(db, id, `octo/${id}`);
  }
  rooms.building.setCompound(snapshot(PLACED));
  rooms.building.attachWorld(new AgentWorld({ agents: () => agents, mayEnter: () => true }));
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

const personalAgent = (ownerUserId: string): WorldAgent => ({
  id: `agent-of-${ownerUserId}`,
  name: "Quillon",
  ownerUserId,
  ownerName: ownerUserId,
  appearance: "secretary",
  status: "ready",
  dismissed: false,
});

test("a person comes back on the same level, in the same room, at the same spot, facing the same way", async () => {
  person("u-ante", { [ALPHA]: "spawn" });
  person("u-mia");
  const place = inRoom(ALPHA);
  await standAndLeave("u-ante", place);
  expect(stored("u-ante")).toMatchObject(place);

  // Another device: a new connection, nothing carried over by the client.
  const mia = await joinAs("u-mia");
  agents = [personalAgent("u-ante")];
  const ante = await joinAs("u-ante");
  expect(ante.first).toEqual(place);
  expect(ante.room.state.levels.has(LEVEL)).toBe(true);

  // Standing in Alpha again, they are seen only by who may see into Alpha.
  await Bun.sleep(150);
  expect(mia.room.state.humans.has(ante.room.sessionId)).toBe(false);
  expectNoTrace(mia, ALPHA, LEVEL);

  // Their personal agent comes to them, in that room on that level.
  const body = () => ante.room.state.officeAgents?.get("agent-of-u-ante");
  await waitFor(
    () =>
      body()?.mode === "follow" &&
      body()?.levelId === LEVEL &&
      Math.hypot((body()?.target.x ?? 0) - place.x, (body()?.target.z ?? 0) - place.z) < 2.5,
    "the agent beside its owner in Alpha",
    6000,
  );
  expect(body()?.operationId).toBe(ALPHA);
});

test("the lobby level too: a spot in the lobby, for someone with no GitHub link", async () => {
  person("u-lou");
  const place: ReturnPlace = { ...AT_SPAWN, x: SPAWN.x - 5, z: SPAWN.z + 2, heading: -2.5 };
  await standAndLeave("u-lou", place);
  const lou = await joinAs("u-lou");
  expect(lou.first).toEqual(place);
});

test("the room was taken from them, and the level with it: the lobby, no word of it, the place forgotten", async () => {
  person("u-bea", { [ALPHA]: "manage" });
  const place = inRoom(ALPHA);
  await standAndLeave("u-bea", place);
  // Her GitHub access no longer covers Alpha, her only room on that level.
  seedRoomMember(db, "u-bea", ALPHA, null);

  agents = [personalAgent("u-bea")];
  const bea = await joinAs("u-bea");
  expect(bea.first).toEqual(AT_SPAWN);
  expect(stored("u-bea")).toBeUndefined();
  // Her agent is beside her in the lobby, not where she used to stand.
  const body = () => bea.room.state.officeAgents?.get("agent-of-u-bea");
  await waitFor(
    () =>
      body()?.mode === "follow" &&
      Math.hypot((body()?.target.x ?? 0) - SPAWN.x, (body()?.target.z ?? 0) - SPAWN.z) < 2.5,
    "the agent beside its owner in the lobby",
    6000,
  );
  expect(body()?.levelId).toBe(LOBBY_LEVEL_ID);
  expect(body()?.operationId).toBe(LOBBY_OPERATION_ID);
  // Nothing she was sent or holds names the room or its level; nothing was refused aloud.
  expectNoTrace(bea, ALPHA, LEVEL);
  expect(bea.messages.filter((m) => m.type.includes("reject"))).toEqual([]);
  // And it stays forgotten: giving the room back does not put her back in it.
  await Promise.race([bea.room.leave(), Bun.sleep(500)]);
  seedRoomMember(db, "u-bea", ALPHA, "manage");
  expect((await joinAs("u-bea")).first).toEqual(AT_SPAWN);
});

test("the room was taken from them but the level is still theirs: the lobby all the same", async () => {
  person("u-cy", { [ALPHA]: "spawn", [BETA]: "view" });
  await standAndLeave("u-cy", inRoom(ALPHA));
  seedRoomMember(db, "u-cy", ALPHA, null);
  const cy = await joinAs("u-cy");
  expect(cy.first).toEqual(AT_SPAWN);
  expect(stored("u-cy")).toBeUndefined();
  // The level is still on their lift, and Alpha is a closed door with no name (D26).
  expect(cy.room.state.levels.has(LEVEL)).toBe(true);
  expect(cy.room.state.operations.has(ALPHA)).toBe(false);
});

test("the room was archived: the lobby, and the place forgotten", async () => {
  person("u-dan", { [GAMMA]: "spawn", [BETA]: "view" });
  await standAndLeave("u-dan", inRoom(GAMMA));
  db.update(schema.operations)
    .set({ archivedAt: new Date() })
    .where(eq(schema.operations.id, GAMMA))
    .run();
  await rooms.refreshOperations();
  const dan = await joinAs("u-dan");
  expect(dan.first).toEqual(AT_SPAWN);
  expect(stored("u-dan")).toBeUndefined();
  expectNoTrace(dan, GAMMA);
});

test("the room was moved: the old spot is rock now, so the lobby", async () => {
  person("u-eve", { [DELTA]: "manage" });
  await standAndLeave("u-eve", inRoom(DELTA));
  const moved = PLACED.filter((r) => r.id !== GAMMA).map((r) =>
    r.id === DELTA ? { ...r, placement: { ...r.placement, gridX: 24 } } : r,
  );
  rooms.building.setCompound(snapshot(moved));
  const eve = await joinAs("u-eve");
  expect(eve.first).toEqual(AT_SPAWN);
  expect(stored("u-eve")).toBeUndefined();
  rooms.building.setCompound(snapshot(PLACED.filter((r) => r.id !== GAMMA)));
});

test("a stored place is never trusted: a sealed room, a wall, another level's spot", async () => {
  person("u-kim");
  person("u-ned", { [BETA]: "view" });
  const alpha = middleOf(ALPHA);
  const door = doorApproach({ x: 8, y: 30, w: 8, d: 8 }, "south");
  const wishes: Array<[string, ReturnPlace]> = [
    // No access at all, a row that says "in Alpha".
    ["u-kim", inRoom(ALPHA)],
    // The corridor of a level they do not reach.
    ["u-kim", { levelId: LEVEL, operationId: LOBBY_OPERATION_ID, ...door }],
    // On the level by right (Beta), "in no room", at a spot inside Alpha, which is sealed to them.
    ["u-ned", { levelId: LEVEL, operationId: LOBBY_OPERATION_ID, ...alpha, heading: 0 }],
    ["u-ned", inRoom(ALPHA)],
    // Inside the lobby's wall, and in the rock.
    ["u-kim", { ...AT_SPAWN, x: spec.lobby.x * 2 + 0.1 }],
    ["u-kim", { ...AT_SPAWN, x: 3, z: 3 }],
  ];
  for (const [userId, wish] of wishes) {
    db.delete(schema.userPlaces).where(eq(schema.userPlaces.userId, userId)).run();
    db.insert(schema.userPlaces)
      .values({ userId, ...wish })
      .run();
    const joined = await joinAs(userId);
    expect(joined.first).toEqual(AT_SPAWN);
    expect(stored(userId)).toBeUndefined();
    // Kim reaches no level but the lobby's; Ned sees Alpha's closed door from outside (D26).
    if (userId === "u-kim") expectNoTrace(joined, ALPHA, LEVEL);
    else expect(joined.room.state.operations.has(ALPHA)).toBe(false);
    await Promise.race([joined.room.leave(), Bun.sleep(500)]);
  }
  // The corridor in front of Alpha's door is Ned's to stand in: that one is honoured.
  const corridor: ReturnPlace = { levelId: LEVEL, operationId: LOBBY_OPERATION_ID, ...door };
  db.delete(schema.userPlaces).where(eq(schema.userPlaces.userId, "u-ned")).run();
  db.insert(schema.userPlaces)
    .values({ userId: "u-ned", ...corridor })
    .run();
  expect((await joinAs("u-ned")).first).toEqual(corridor);
});

test("a client that sends itself into a sealed room does not come back there", async () => {
  person("u-oz", { [BETA]: "view" });
  // On the level by right, it claims a position inside Alpha without ever entering it.
  await standAndLeave("u-oz", {
    levelId: LEVEL,
    operationId: LOBBY_OPERATION_ID,
    ...middleOf(ALPHA),
    heading: 0,
  });
  const oz = await joinAs("u-oz");
  expect(oz.first).toEqual(AT_SPAWN);
  expect(stored("u-oz")).toBeUndefined();
});

test("only the place comes back: a coffee buzz does not (#63)", async () => {
  person("u-joe");
  const machine = coffeeMachineSpot(compoundStateOf(computeCompoundLayout(spec, [])));
  if (!machine) throw new Error("no coffee machine");
  const place: ReturnPlace = { ...AT_SPAWN, x: machine.stand.x, z: machine.stand.z, heading: 1 };
  const { room } = await joinAs("u-joe");
  room.send("move", { x: place.x, z: place.z, heading: place.heading });
  const me = () => room.state.humans.get(room.sessionId);
  await waitFor(() => me()?.position.x === place.x, "Joe at the machine");
  room.send("coffee.drink", {});
  await waitFor(() => (me()?.cups ?? 0) === 1 && (me()?.buzzUntil ?? 0) > 0, "Joe's cup");
  await Promise.race([room.leave(), Bun.sleep(500)]);
  await waitFor(() => stored("u-joe")?.x === place.x, "Joe's place to be remembered");

  // Back at the machine, on a new presence: no cups and no buzz carried over.
  const joe = await joinAs("u-joe");
  expect(joe.first).toEqual(place);
  const back = joe.room.state.humans.get(joe.room.sessionId);
  expect(back?.cups).toBe(0);
  expect(back?.buzzUntil).toBe(0);
});

test("an agent its owner stopped while they were away is not beside them on return (#301)", async () => {
  person("u-sam");
  const place: ReturnPlace = { ...AT_SPAWN, x: SPAWN.x + 4, z: SPAWN.z - 1, heading: 0.5 };
  agents = [personalAgent("u-sam")];
  const watcher = await joinAs("u-mia");
  const body = (room: BuildingRoom) => room.state.officeAgents?.get("agent-of-u-sam");
  const first = await joinAs("u-sam");
  await waitFor(() => body(first.room)?.mode === "follow", "the agent with its owner", 6000);
  first.room.send("move", { x: place.x, z: place.z, heading: place.heading });
  await waitFor(
    () => first.room.state.humans.get(first.room.sessionId)?.position.x === place.x,
    "Sam at the spot",
  );
  await Promise.race([first.room.leave(), Bun.sleep(500)]);
  await waitFor(() => stored("u-sam")?.x === place.x, "Sam's place to be remembered");
  // Stopped by its owner: the office's agent list leaves it out (pm/setup.ts), so it has no body.
  agents = [];
  await waitFor(() => body(watcher.room) === undefined, "the body to go", 6000);

  const sam = await joinAs("u-sam");
  expect(sam.first).toEqual(place);
  // Longer than the world takes to re-read its agents and step: still nobody beside them.
  await Bun.sleep(2600);
  expect(body(sam.room)).toBeUndefined();
  // The world re-reads its agents every two seconds, and this waits for that twice.
}, 20_000);
