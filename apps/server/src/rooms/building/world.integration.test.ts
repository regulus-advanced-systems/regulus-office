/**
 * Office agents' bodies through the real BuildingRoom (#252): the room steps
 * the world, two connected people see the same body in their state, and only
 * the person concerned gets the "look at your agents" nudge.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import {
  BuildingStateSchema,
  type CompoundState,
  EMPTY_COMPOUND,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  OFFICE_AGENT_ATTENTION_MESSAGE,
  OfficeAgentBodySchema,
  ROOM_NAMES,
} from "@regulus/protocol";
import { closeDatabase, type Db, openDatabase, runMigrations, schema } from "../../db/index.ts";
import { seedRoomAccess, seedRoomRepo } from "../../github/access/test-snapshot.ts";
import { createOfficeServer, type OfficeServer } from "../../http/server.ts";
import { createLogger } from "../../logging.ts";
import { AgentWorld, PmRounds, type WorldAgent } from "../../pm/world/index.ts";
import { createDevHeaderAuth, DEV_USER_HEADER } from "../auth.ts";
import { createRooms, type Rooms } from "../index.ts";

type BuildingState = InstanceType<typeof BuildingStateSchema>;
type BuildingRoom = Room<unknown, BuildingState>;

const LOBBY = { gridX: 26, gridY: 56, width: 12, depth: 8 };
const COMPOUND: CompoundState = {
  ...EMPTY_COMPOUND,
  width: 64,
  depth: 64,
  version: 3,
  specialRooms: [{ kind: "lobby", ...LOBBY, doorSide: "north", doorX: 31, doorY: 56 }],
};
const AGENTS: WorldAgent[] = [
  {
    id: "a-personal",
    name: "Quillon",
    ownerUserId: "u-ante",
    ownerName: "Ante",
    appearance: "secretary",
    status: "ready",
    dismissed: false,
  },
  {
    id: "a-shared",
    name: "Number Two",
    ownerUserId: null,
    ownerName: "",
    appearance: "standard",
    status: "stopped",
    dismissed: false,
  },
];

const ALPHA = "room-alpha-private";
const ANTE_LEVEL = "lv-ante-private";

let dataDir: string;
let db: Db;
let rooms: Rooms;
let server: OfficeServer;
const opened: BuildingRoom[] = [];

async function joinAs(userId: string, displayName: string): Promise<BuildingRoom> {
  const client = new Client(String(server.url).replace(/\/$/, ""), {
    headers: { [DEV_USER_HEADER]: JSON.stringify({ userId, displayName, role: "member" }) },
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

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "office-world-"));
  db = openDatabase({ path: join(dataDir, "office.db") });
  runMigrations(db);
  const logger = createLogger({ level: "silent" });
  rooms = createRooms({
    db,
    logger,
    auth: createDevHeaderAuth({ NODE_ENV: "test" }),
    publicUrl: "https://office.example.com",
    production: false,
    // These tests are about someone who arrives at the lobby spawn; coming back where
    // you left has its own (returning.integration.test.ts).
    places: null,
  });
  // Alpha, a project room on Ante's level: Ante's GitHub access covers it, Mia's does not.
  for (const [id, name] of [
    ["u-ante", "Ante"],
    ["u-mia", "Mia"],
  ] as const) {
    db.insert(schema.users)
      .values({ id, name, email: `${id}@example.com`, emailVerified: false })
      .run();
    db.insert(schema.userProfiles).values({ userId: id, displayName: name, role: "member" }).run();
  }
  db.insert(schema.levels)
    .values({ id: ANTE_LEVEL, kind: "account", login: "ante", name: "ante", position: 1 })
    .run();
  db.insert(schema.operations)
    .values({
      id: ALPHA,
      name: "Alpha",
      slug: "alpha",
      index: 1,
      paletteId: "oak-sky",
      layoutTemplateId: "l2",
      levelId: ANTE_LEVEL,
    })
    .run();
  seedRoomRepo(db, ALPHA, "ante/alpha");
  seedRoomAccess(db, "u-ante", ALPHA, "admin");
  const level = (levelId: string, kind: "lobby" | "account", login: string, order: number) =>
    ({ levelId, kind, login, name: login || "Lobby", order, state: COMPOUND }) as const;
  rooms.building.setCompound({
    state: COMPOUND,
    rooms: new Map([
      [
        ALPHA,
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
    levels: [level(LOBBY_LEVEL_ID, "lobby", "", 0), level(ANTE_LEVEL, "account", "ante", 1)],
  });
  rooms.building.attachWorld(new AgentWorld({ agents: () => AGENTS, mayEnter: () => false }));
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

test("both people see the same bodies; the personal one follows its owner", async () => {
  const ante = await joinAs("u-ante", "Ante");
  const mia = await joinAs("u-mia", "Mia");
  ante.send("move", { x: 64, z: 120, heading: 0 });
  await waitFor(
    () => mia.state.officeAgents?.get("a-personal")?.mode === "follow",
    "the personal agent to follow",
  );
  await waitFor(() => ante.state.officeAgents?.size === 2, "both bodies at the owner");
  for (const view of [ante, mia]) {
    const mine = view.state.officeAgents.get("a-personal");
    expect(mine?.ownerUserId).toBe("u-ante");
    expect(mine?.ownerName).toBe("Ante");
    expect(mine?.appearance).toBe("secretary");
    expect(Math.hypot((mine?.target.x ?? 0) - 64, (mine?.target.z ?? 0) - 120)).toBeLessThan(2);
    const shared = view.state.officeAgents.get("a-shared");
    expect(shared?.mode).toBe("wander");
    expect(shared?.ownerUserId).toBe("");
  }
  // What the other person sees is exactly what the owner sees.
  expect(mia.state.officeAgents.toJSON()).toEqual(ante.state.officeAgents.toJSON());

  // The owner walks off: one new target, the same for both.
  ante.send("move", { x: 68, z: 122, heading: 0 });
  await waitFor(() => {
    const t = mia.state.officeAgents.get("a-personal")?.target;
    return !!t && Math.hypot(t.x - 68, t.z - 122) < 2;
  }, "the agent to be sent after its owner");
});

test("the attention nudge reaches the person it is for and nobody else", async () => {
  const ante = await joinAs("u-ante", "Ante");
  const mia = await joinAs("u-mia", "Mia");
  let forAnte = 0;
  let forMia = 0;
  ante.onMessage(OFFICE_AGENT_ATTENTION_MESSAGE, () => forAnte++);
  mia.onMessage(OFFICE_AGENT_ATTENTION_MESSAGE, () => forMia++);
  rooms.building.sendToUser("u-ante", OFFICE_AGENT_ATTENTION_MESSAGE, {});
  await waitFor(() => forAnte === 1, "the nudge");
  await Bun.sleep(100);
  expect(forMia).toBe(0);
});

test("a body in a room is sent only to the people who may see into that room (#270)", async () => {
  const ante = await joinAs("u-ante", "Ante");
  const mia = await joinAs("u-mia", "Mia");
  // A stand-in world that puts one body where the test says.
  let place: { levelId: string; operationId: string } | null = {
    levelId: ANTE_LEVEL,
    operationId: ALPHA,
  };
  rooms.building.attachWorld({
    tick(state) {
      if (!place) return false;
      state.officeAgents.clear();
      const body = new OfficeAgentBodySchema();
      body.agentId = "a-follower";
      body.name = "Follower";
      body.ownerUserId = "u-ante";
      body.ownerName = "Ante";
      body.levelId = place.levelId;
      body.operationId = place.operationId;
      state.officeAgents.set(body.agentId, body);
      place = null;
      return true;
    },
  });
  const wire = (room: BuildingRoom) => JSON.stringify(room.state.toJSON());
  const has = (room: BuildingRoom) => room.state.officeAgents?.has("a-follower") ?? false;

  // In Alpha with its owner: the owner has it, the other person has no trace of it or the room.
  await waitFor(() => has(ante), "the owner to get the body in Alpha");
  await Bun.sleep(200);
  expect(has(mia)).toBe(false);
  expect(wire(mia)).not.toContain("a-follower");
  expect(wire(mia)).not.toContain(ALPHA);
  expect(wire(mia)).not.toContain(ANTE_LEVEL);

  // Out in the lobby: everyone sees it.
  place = { levelId: LOBBY_LEVEL_ID, operationId: LOBBY_OPERATION_ID };
  await waitFor(() => has(mia), "the other person to get the body in the lobby");
  expect(mia.state.officeAgents.get("a-follower")?.ownerName).toBe("Ante");
  expect(has(ante)).toBe(true);

  // Back into Alpha: gone for the other person again.
  place = { levelId: ANTE_LEVEL, operationId: ALPHA };
  await waitFor(() => !has(mia), "the body to leave the other person's state");
  await waitFor(() => ante.state.officeAgents.get("a-follower")?.operationId === ALPHA, "owner");
  expect(wire(mia)).not.toContain(ALPHA);
});

test("the office PM's round: in a room, its body reaches only the viewer whose access covers it (#60)", async () => {
  const ante = await joinAs("u-ante", "Ante");
  const mia = await joinAs("u-mia", "Mia");
  // Rounds every two seconds, held back until the test has seen it at its desk. The PM was
  // granted Alpha.
  let released = false;
  const rounds = new PmRounds({ henchmen: () => [], everyMs: 2_000 });
  const world = new AgentWorld({
    agents: () => [
      {
        id: "a-pm",
        name: "Ledger",
        ownerUserId: null,
        ownerName: "",
        appearance: "number_two",
        status: "ready",
        dismissed: false,
        post: "reception",
      },
    ],
    mayEnter: (_agentId, operationId) => operationId === ALPHA,
    duty: (agent, context) => (released ? rounds.duty(agent, context) : null),
  });
  rooms.building.attachWorld(world);
  const body = (room: BuildingRoom) => room.state.officeAgents?.get("a-pm");
  const wire = (room: BuildingRoom) => JSON.stringify(room.state.toJSON());

  // At reception both of them see it.
  await waitFor(
    () => body(mia)?.mode === "post" && body(ante)?.mode === "post",
    "the PM at its post",
  );
  expect(mia.state.officeAgents.toJSON()).toEqual(ante.state.officeAgents.toJSON());
  expect(body(mia)).toMatchObject({ post: "reception", doing: "at reception" });

  released = true;
  // On its round it walks into Alpha: Ante, who may enter Alpha, sees it at the boards there;
  // Mia, whose GitHub access does not cover Alpha, has no body and no trace of the room.
  await waitFor(() => body(ante)?.operationId === ALPHA, "the PM in Alpha for Ante", 6_000);
  expect(body(ante)).toMatchObject({ mode: "route", levelId: ANTE_LEVEL });
  expect(body(ante)?.doing).toMatch(/^checking the (issue|PR) board$/);
  await waitFor(() => body(mia) === undefined, "the body to leave Mia's state");
  await Bun.sleep(200);
  expect(body(mia)).toBeUndefined();
  expect(wire(mia)).not.toContain("a-pm");
  expect(wire(mia)).not.toContain(ALPHA);
  expect(wire(mia)).not.toContain("checking the");

  // Sent back to its desk: Mia has it again, the same body Ante has.
  world.setRoute("a-pm", null);
  await waitFor(() => body(mia)?.operationId === LOBBY_OPERATION_ID, "the PM back for Mia");
  await waitFor(() => body(ante)?.operationId === LOBBY_OPERATION_ID, "the PM back for Ante");
  expect(body(mia)?.levelId).toBe(LOBBY_LEVEL_ID);
}, 20_000);

test("an owner who has not moved since joining has their agent beside them, not at 0,0 (#252)", async () => {
  rooms.building.attachWorld(new AgentWorld({ agents: () => AGENTS, mayEnter: () => false }));
  // Ante signs in and stands still: no `move` is ever sent.
  const ante = await joinAs("u-ante", "Ante");
  const mia = await joinAs("u-mia", "Mia");
  const spawn = {
    x: (LOBBY.gridX + LOBBY.width / 2) * COMPOUND.tileMetres,
    z: (LOBBY.gridY + LOBBY.depth / 2) * COMPOUND.tileMetres,
  };
  // This session of theirs (earlier tests left others connected).
  const me = (room: BuildingRoom) => room.state.humans.get(ante.sessionId);
  // Everyone has them where their own client puts them: the middle of the lobby.
  await waitFor(() => me(mia) !== undefined, "Ante in Mia's state");
  for (const view of [ante, mia]) {
    expect(me(view)?.position.x).toBe(spawn.x);
    expect(me(view)?.position.z).toBe(spawn.z);
  }
  await waitFor(
    () => mia.state.officeAgents?.get("a-personal")?.mode === "follow",
    "the personal agent to follow",
  );
  const target = mia.state.officeAgents.get("a-personal")?.target;
  expect(Math.hypot((target?.x ?? 0) - spawn.x, (target?.z ?? 0) - spawn.z)).toBeLessThan(2);
  // Nowhere near the corner of the map.
  expect(Math.hypot(target?.x ?? 0, target?.z ?? 0)).toBeGreaterThan(50);
  // Their first move still wins.
  ante.send("move", { x: spawn.x + 4, z: spawn.z + 2, heading: 0 });
  await waitFor(() => {
    const t = mia.state.officeAgents.get("a-personal")?.target;
    return !!t && Math.hypot(t.x - (spawn.x + 4), t.z - (spawn.z + 2)) < 2;
  }, "the agent to be sent after its owner");
});
