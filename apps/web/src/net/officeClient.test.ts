import { beforeEach, describe, expect, test } from "bun:test";
import {
  type BuildingState,
  type CommandRejected,
  DEFAULT_ROOM_SETTINGS,
  EMPTY_COMPOUND,
  type FloorState,
  UNPLACED_ROOM,
} from "@regulus/protocol";
import { useBuildingStore } from "../state/building.ts";
import { useConnectionStore } from "../state/connection.ts";
import { useFloorStore } from "../state/floor.ts";
import { useRoomsStore } from "../state/rooms.ts";
import { OfficeClient, type Scheduler } from "./officeClient.ts";
import type { FloorJoinOptions, RoomHandle, RoomTransport } from "./transport.ts";

// ---- fixtures ---------------------------------------------------------------

const emptyBuilding = (): BuildingState => ({
  humans: {},
  floors: {
    f1: {
      floorId: "f1",
      name: "One",
      slug: "one",
      index: 1,
      paletteId: "teal-cream",
      robotsWorking: 0,
      robotsWaiting: 0,
      robotsTotal: 0,
      humansPresent: 0,
      ...UNPLACED_ROOM,
      ...DEFAULT_ROOM_SETTINGS,
    },
  },
  chat: [],
  jukebox: {
    trackId: "",
    startedAtServerMs: 0,
    pausedAtMs: 0,
    playing: false,
    volume: 0.5,
    queue: [],
  },
  usage: {
    todayInputTokens: 0,
    todayOutputTokens: 0,
    todayCacheTokens: 0,
    todayCostUsdEstimate: 0,
    officeKeysCostUsdEstimate: 0,
    activeHumans: 0,
    topRobots: [],
    dayStart: 0,
    observedAt: 0,
  },
  pm: {
    enabled: false,
    privilege: "coordinator",
    activity: "idle",
    floorId: "lobby",
    position: { x: 0, z: 0, heading: 0 },
    animation: "idle",
    doing: "",
    targetAgentId: "",
    lastBriefAt: 0,
  },
  compound: EMPTY_COMPOUND,
});

const emptyFloor = (floorId: string): FloorState => ({
  floorId,
  name: floorId,
  slug: floorId,
  paletteId: "teal-cream",
  layoutTemplateId: "small",
  repos: [],
  robots: {},
  desks: {},
  decor: {},
  queue: [],
  issues: {},
  pulls: {},
  services: {},
  whiteboardVersion: 0,
  carriedCards: {},
  queueSettings: { maxRunning: 2, maxPerOwner: 2 },
  deskCount: 1,
  decorStyle: "ops_room",
});

// ---- fake transport ---------------------------------------------------------

class FakeRoom<S> implements RoomHandle<S> {
  static nextId = 1;
  roomId = `room-${FakeRoom.nextId++}`;
  sessionId = `sess-${this.roomId}`;
  sent: Array<{ type: string; payload: unknown }> = [];
  left: boolean[] = [];
  private state: S;
  private stateCbs = new Set<(s: S) => void>();
  private leaveCbs = new Set<(code: number, reason?: string) => void>();
  private dropCbs = new Set<(code: number, reason?: string) => void>();
  private reconnectCbs = new Set<() => void>();
  private rejectedCbs = new Set<(notice: CommandRejected) => void>();
  private messageCbs = new Map<string, Set<(payload: unknown) => void>>();

  constructor(initial: S) {
    this.state = initial;
  }
  snapshot() {
    return structuredClone(this.state);
  }
  onState(cb: (s: S) => void) {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }
  onDrop(cb: (code: number, reason?: string) => void) {
    this.dropCbs.add(cb);
    return () => this.dropCbs.delete(cb);
  }
  onReconnect(cb: () => void) {
    this.reconnectCbs.add(cb);
    return () => this.reconnectCbs.delete(cb);
  }
  onLeave(cb: (code: number, reason?: string) => void) {
    this.leaveCbs.add(cb);
    return () => this.leaveCbs.delete(cb);
  }
  onError() {
    return () => undefined;
  }
  onRejected(cb: (notice: CommandRejected) => void) {
    this.rejectedCbs.add(cb);
    return () => this.rejectedCbs.delete(cb);
  }
  onMessage(type: string, cb: (payload: unknown) => void) {
    const set = this.messageCbs.get(type) ?? new Set();
    this.messageCbs.set(type, set);
    set.add(cb);
    return () => set.delete(cb);
  }
  send(type: string, payload: unknown) {
    this.sent.push({ type, payload });
  }
  async leave(consented = true) {
    this.left.push(consented);
    for (const cb of this.leaveCbs) cb(consented ? 4000 : 1006);
  }
  // server-side simulation helpers
  patch(mutate: (s: S) => void) {
    mutate(this.state);
    for (const cb of this.stateCbs) cb(this.snapshot());
  }
  serverClose(code: number, reason?: string) {
    for (const cb of this.leaveCbs) cb(code, reason);
  }
  drop(code = 1006) {
    for (const cb of this.dropCbs) cb(code, "dropped");
  }
  reconnect() {
    for (const cb of this.reconnectCbs) cb();
  }
  reject(notice: CommandRejected) {
    for (const cb of this.rejectedCbs) cb(notice);
  }
  message(type: string, payload: unknown) {
    for (const cb of this.messageCbs.get(type) ?? []) cb(payload);
  }
  listenerCount(type: string) {
    return this.messageCbs.get(type)?.size ?? 0;
  }
}

class FakeTransport implements RoomTransport {
  buildingRooms: FakeRoom<BuildingState>[] = [];
  floorRooms: FakeRoom<FloorState>[] = [];
  floorJoins: FloorJoinOptions[] = [];
  failBuildingJoins = 0;
  failFloorJoins = 0;
  /** Reject floor joins like the server does without floor access. */
  denyFloorJoins = false;
  /** Resolvers for joins that should stay pending until released. */
  holdFloorJoins = false;
  private pendingFloor: Array<() => void> = [];

  async joinBuilding() {
    if (this.failBuildingJoins > 0) {
      this.failBuildingJoins--;
      throw new Error("matchmake failed");
    }
    const room = new FakeRoom(emptyBuilding());
    this.buildingRooms.push(room);
    return room;
  }
  async joinFloor(options: FloorJoinOptions) {
    this.floorJoins.push(options);
    if (this.holdFloorJoins) await new Promise<void>((r) => this.pendingFloor.push(r));
    if (this.denyFloorJoins) throw Object.assign(new Error("access denied"), { code: 403 });
    if (this.failFloorJoins > 0) {
      this.failFloorJoins--;
      throw new Error("floor full");
    }
    const room = new FakeRoom(emptyFloor(options.floorId));
    this.floorRooms.push(room);
    return room;
  }
  releaseFloorJoins() {
    const pending = this.pendingFloor;
    this.pendingFloor = [];
    for (const r of pending) r();
  }
  get building() {
    return this.buildingRooms.at(-1) as FakeRoom<BuildingState>;
  }
  get floor() {
    return this.floorRooms.at(-1) as FakeRoom<FloorState>;
  }
}

/** Manual scheduler: timers fire only when the test says so. */
class FakeClock {
  timers: Array<{ fn: () => void; delay: number; cancelled: boolean }> = [];
  schedule: Scheduler = (fn, delay) => {
    const t = { fn, delay, cancelled: false };
    this.timers.push(t);
    return () => {
      t.cancelled = true;
    };
  };
  get pendingDelays() {
    return this.timers.filter((t) => !t.cancelled).map((t) => t.delay);
  }
  async fireNext() {
    const t = this.timers.find((x) => !x.cancelled);
    if (!t) throw new Error("no pending timer");
    t.cancelled = true;
    t.fn();
    await flush();
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const stores = { building: useBuildingStore, floor: useFloorStore, connection: useConnectionStore };
const noJitter = () => 0.5;

function setup(overrides: Partial<ConstructorParameters<typeof OfficeClient>[0]> = {}) {
  const transport = new FakeTransport();
  const clock = new FakeClock();
  const client = new OfficeClient({
    transport,
    stores,
    schedule: clock.schedule,
    random: noJitter,
    backoff: { baseMs: 100, maxMs: 1000, factor: 2, jitter: 0 },
    maxAttempts: 3,
    ...overrides,
  });
  return { transport, clock, client };
}

beforeEach(() => {
  useBuildingStore.getState().clear();
  useFloorStore.getState().clear();
  useRoomsStore.getState().clear();
  useConnectionStore.setState({ status: "idle", attempt: 0, lastError: null });
});

// ---- tests --------------------------------------------------------------------

describe("OfficeClient", () => {
  test("connect joins the building and patches state into the building store", async () => {
    const { transport, client } = setup();
    await client.connect();
    expect(useConnectionStore.getState().status).toBe("connected");
    expect(useBuildingStore.getState().sessionId).toBe(transport.building.sessionId);
    expect(Object.keys(useBuildingStore.getState().state?.floors ?? {})).toEqual(["f1"]);

    transport.building.patch((s) => {
      s.chat.push({ id: "m1", userId: "u1", displayName: "A", floorId: "", text: "hi", ts: 1 });
    });
    expect(useBuildingStore.getState().state?.chat).toHaveLength(1);
  });

  test("joins exactly one floor at a time and patches the floor store", async () => {
    const { transport, client } = setup();
    await client.connect();
    await client.goToFloor("f1");
    expect(useFloorStore.getState().floorId).toBe("f1");
    transport.floor.patch((s) => {
      s.whiteboardVersion = 7;
    });
    expect(useFloorStore.getState().state?.whiteboardVersion).toBe(7);

    const first = transport.floor;
    await client.goToFloor("f2");
    expect(first.left).toEqual([true]);
    expect(transport.floorRooms).toHaveLength(2);
    expect(client.currentFloorId).toBe("f2");
    expect(useFloorStore.getState().state?.floorId).toBe("f2");

    await client.goToFloor("f2"); // no-op
    expect(transport.floorRooms).toHaveLength(2);
  });

  test("setRooms tells the building where we are; the lobby has no floor room", async () => {
    const { transport, client } = setup();
    await client.connect();
    await client.setRooms("f1");
    expect(transport.building.sent).toEqual([
      { type: "floor.go", payload: { floorId: "f1", mode: "teleport" } },
    ]);
    expect(client.currentFloorId).toBe("f1");
    const floorRoom = transport.floor;
    await client.setRooms(null);
    expect(floorRoom.left).toEqual([true]);
    expect(client.currentFloorId).toBeNull();
    expect(useFloorStore.getState().floorId).toBeNull();
    expect(transport.building.sent.at(-1)).toEqual({
      type: "floor.go",
      payload: { floorId: "lobby", mode: "teleport" },
    });
  });

  test("joins the current room and up to three nearby rooms, leaving the rest (#186)", async () => {
    const { transport, client } = setup();
    await client.connect();
    await client.setRooms("f1", ["f2", "f3", "f4", "f5"]);
    expect(transport.floorJoins.map((j) => j.floorId)).toEqual(["f1", "f2", "f3", "f4"]);
    expect(client.joinedFloorIds.sort()).toEqual(["f1", "f2", "f3", "f4"]);
    expect(Object.keys(useRoomsStore.getState().states).sort()).toEqual(["f1", "f2", "f3", "f4"]);
    // The HUD's floor store mirrors only the room we are in.
    expect(useFloorStore.getState().state?.floorId).toBe("f1");
    const [r1, r2, r3, r4] = transport.floorRooms;
    r2?.patch((s) => {
      s.whiteboardVersion = 3;
    });
    expect(useRoomsStore.getState().states.f2?.whiteboardVersion).toBe(3);
    expect(useFloorStore.getState().state?.whiteboardVersion).toBe(0);

    // Walking into f2: no new join, the HUD switches at once; f4 drops out of view.
    await client.setRooms("f2", ["f1", "f3"]);
    expect(transport.floorJoins).toHaveLength(4);
    expect(useFloorStore.getState().state?.floorId).toBe("f2");
    expect(useFloorStore.getState().state?.whiteboardVersion).toBe(3);
    expect(r4?.left).toEqual([true]);
    expect(useRoomsStore.getState().states.f4).toBeUndefined();
    expect([r1, r2, r3].map((r) => r?.left)).toEqual([[], [], []]);
    expect(transport.building.sent.map((m) => (m.payload as { floorId: string }).floorId)).toEqual([
      "f1",
      "f2",
    ]);
  });

  test("commands and messages follow the room we are in, not the nearby ones", async () => {
    const { transport, client } = setup();
    const seen: unknown[] = [];
    const rejected: string[] = [];
    client.onFloorMessage("agent.permissions", (p) => seen.push(p));
    client.onRejected((n) => rejected.push(n.type));
    await client.connect();
    await client.setRooms("f1", ["f2"]);
    const [r1, r2] = transport.floorRooms;
    client.send("agent.stop", { agentId: "a1" });
    expect(r1?.sent).toHaveLength(1);
    expect(r2?.sent).toHaveLength(0);
    r2?.message("agent.permissions", { from: "f2" });
    r2?.reject({ type: "agent.spawn", reason: "nearby" });
    r1?.message("agent.permissions", { from: "f1" });
    await client.setRooms("f2", ["f1"]);
    r2?.message("agent.permissions", { from: "f2 now" });
    r1?.message("agent.permissions", { from: "f1 now nearby" });
    expect(seen).toEqual([{ from: "f1" }, { from: "f2 now" }]);
    expect(rejected).toEqual([]);
  });

  test("a denied floor join is not retried", async () => {
    const { transport, clock, client } = setup();
    await client.connect();
    transport.denyFloorJoins = true;
    await client.goToFloor("f1");
    expect(clock.pendingDelays).toEqual([]);
    expect(useFloorStore.getState().floorId).toBeNull();
    expect(useConnectionStore.getState().lastError).toBe("access denied");
  });

  test("routes commands to the owning room and refuses when it is not joined", async () => {
    const { transport, client } = setup();
    await client.connect();
    client.send("chat", { text: "hello" });
    expect(transport.building.sent).toEqual([{ type: "chat", payload: { text: "hello" } }]);
    expect(() => client.send("agent.stop", { agentId: "a1" })).toThrow(/floor room not joined/);
    await client.goToFloor("f1");
    client.send("agent.stop", { agentId: "a1" });
    expect(transport.floor.sent).toEqual([{ type: "agent.stop", payload: { agentId: "a1" } }]);
  });

  test("forwards command.rejected notices from both rooms until unsubscribed", async () => {
    const { transport, client } = setup();
    const seen: CommandRejected[] = [];
    const off = client.onRejected((n) => seen.push(n));
    await client.connect();
    await client.goToFloor("f1");
    transport.building.reject({ type: "chat", reason: "invalid chat: text: too long" });
    transport.floor.reject({ type: "agent.spawn", reason: "forbidden" });
    expect(seen.map((n) => n.type)).toEqual(["chat", "agent.spawn"]);
    off();
    transport.building.reject({ type: "chat", reason: "again" });
    expect(seen).toHaveLength(2);
  });

  test("building messages reach listeners across re-joins, once each", async () => {
    const { transport, client, clock } = setup();
    const seen: unknown[] = [];
    const off = client.onBuildingMessage("notify.attention", (p) => seen.push(p));
    await client.connect();
    transport.building.message("notify.attention", { agentIds: ["a1"] });
    const first = transport.building;
    first.serverClose(1006, "gone");
    expect(first.listenerCount("notify.attention")).toBe(0);
    await clock.fireNext();
    client.onBuildingMessage("notify.attention", () => undefined);
    expect(transport.building.listenerCount("notify.attention")).toBe(1);
    transport.building.message("notify.attention", { agentIds: [] });
    off();
    transport.building.message("notify.attention", { agentIds: ["a2"] });
    expect(seen).toEqual([{ agentIds: ["a1"] }, { agentIds: [] }]);
  });

  test("floor messages reach listeners on the current and later floors, once each", async () => {
    const { transport, client } = setup();
    const seen: unknown[] = [];
    const off = client.onFloorMessage("agent.permissions", (p) => seen.push(p));
    await client.connect();
    await client.goToFloor("f1");
    transport.floor.message("agent.permissions", { agentId: "a1", requests: [] });
    const first = transport.floor;
    await client.goToFloor("f2");
    expect(first.listenerCount("agent.permissions")).toBe(0);
    transport.floor.message("agent.permissions", { agentId: "a2", requests: [] });
    client.onFloorMessage("agent.permissions", () => undefined);
    expect(transport.floor.listenerCount("agent.permissions")).toBe(1);
    off();
    transport.floor.message("agent.permissions", { agentId: "a3", requests: [] });
    expect(seen).toEqual([
      { agentId: "a1", requests: [] },
      { agentId: "a2", requests: [] },
    ]);
  });

  test("re-joins with exponential backoff when the building room is lost", async () => {
    const { transport, clock, client } = setup();
    await client.connect();
    await client.goToFloor("f1");

    transport.building.serverClose(1006, "socket died");
    expect(useConnectionStore.getState()).toMatchObject({ status: "reconnecting", attempt: 1 });
    expect(useBuildingStore.getState().state).toBeNull();
    expect(useFloorStore.getState().state).toBeNull();
    expect(clock.pendingDelays).toEqual([100]);

    transport.failBuildingJoins = 2;
    await clock.fireNext(); // attempt 1 fails -> attempt 2 scheduled at 200
    await clock.fireNext(); // attempt 2 fails -> attempt 3 scheduled at 400
    expect(clock.timers.map((t) => t.delay)).toEqual([100, 200, 400]);
    expect(useConnectionStore.getState().attempt).toBe(3);

    await clock.fireNext(); // succeeds, and the floor is re-joined
    expect(useConnectionStore.getState()).toMatchObject({ status: "connected", attempt: 0 });
    expect(transport.buildingRooms).toHaveLength(2);
    expect(transport.floorJoins.map((j) => j.floorId)).toEqual(["f1", "f1"]);
    expect(useFloorStore.getState().state?.floorId).toBe("f1");
  });

  test("gives up with status failed after maxAttempts and can be retried manually", async () => {
    const { transport, clock, client } = setup({ maxAttempts: 2 });
    transport.failBuildingJoins = 3;
    await client.connect();
    await clock.fireNext();
    await clock.fireNext();
    expect(useConnectionStore.getState()).toMatchObject({
      status: "failed",
      lastError: "matchmake failed",
    });
    await client.connect();
    expect(useConnectionStore.getState().status).toBe("connected");
  });

  test("a consented close or a kick does not trigger reconnection", async () => {
    const { transport, clock, client } = setup();
    await client.connect();
    transport.building.serverClose(4000, "kicked");
    expect(useConnectionStore.getState()).toMatchObject({ status: "disconnected" });
    expect(clock.pendingDelays).toEqual([]);
  });

  test("transport-level drop and recovery are reflected without leaving the room", async () => {
    const { transport, client } = setup();
    await client.connect();
    transport.building.drop();
    expect(useConnectionStore.getState().status).toBe("reconnecting");
    transport.building.reconnect();
    expect(useConnectionStore.getState().status).toBe("connected");
    expect(transport.buildingRooms).toHaveLength(1);
  });

  test("a lost floor room is re-joined on its own while the building stays connected", async () => {
    const { transport, clock, client } = setup();
    await client.connect();
    await client.goToFloor("f1");
    transport.floor.serverClose(1006);
    expect(useConnectionStore.getState().status).toBe("connected");
    expect(clock.pendingDelays).toEqual([100]);
    await clock.fireNext();
    expect(transport.floorRooms).toHaveLength(2);
    expect(useFloorStore.getState().state?.floorId).toBe("f1");
  });

  test("a floor join superseded by another room change is left immediately", async () => {
    const { transport, client } = setup();
    await client.connect();
    transport.holdFloorJoins = true;
    const p1 = client.goToFloor("f1");
    const p2 = client.goToFloor("f2");
    transport.holdFloorJoins = false;
    transport.releaseFloorJoins();
    await Promise.all([p1, p2]);
    const [r1, r2] = transport.floorRooms;
    expect(r1?.left).toEqual([true]);
    expect(r2?.left).toEqual([]);
    expect(client.currentFloorId).toBe("f2");
  });

  test("disconnect leaves both rooms consented and cancels pending retries", async () => {
    const { transport, clock, client } = setup();
    await client.connect();
    await client.goToFloor("f1");
    const floor = transport.floor;
    const building = transport.building;
    await client.disconnect();
    expect(floor.left).toEqual([true]);
    expect(building.left).toEqual([true]);
    expect(useConnectionStore.getState().status).toBe("disconnected");
    expect(clock.pendingDelays).toEqual([]);
    expect(useBuildingStore.getState().state).toBeNull();
  });
});
