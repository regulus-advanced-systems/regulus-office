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
  OFFICE_AGENT_ATTENTION_MESSAGE,
  ROOM_NAMES,
} from "@regulus/protocol";
import { closeDatabase, type Db, openDatabase, runMigrations } from "../../db/index.ts";
import { createOfficeServer, type OfficeServer } from "../../http/server.ts";
import { createLogger } from "../../logging.ts";
import { AgentWorld, type WorldAgent } from "../../pm/world/index.ts";
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
    name: "Moneypenny",
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
  });
  rooms.building.setCompound({ state: COMPOUND, rooms: new Map() });
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
