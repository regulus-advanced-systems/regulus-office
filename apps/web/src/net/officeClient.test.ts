import { beforeEach, describe, expect, test } from "bun:test";
import {
  ACCESS_CLOSE_CODES,
  BLAST_DOOR_CLOSED,
  type BuildingState,
  type CommandRejected,
  DEFAULT_ROOM_SETTINGS,
  EMPTY_COMPOUND,
  IDLE_JUKEBOX,
  type OperationState,
  UNPLACED_ROOM,
} from "@regulus/protocol";
import { useBuildingStore } from "../state/building.ts";
import { useConnectionStore } from "../state/connection.ts";
import { useOperationStore } from "../state/operation.ts";
import { useRoomsStore } from "../state/rooms.ts";
import { type AccessNotice, OfficeClient, type Scheduler } from "./officeClient.ts";
import type { OperationJoinOptions, RoomHandle, RoomTransport } from "./transport.ts";

// ---- fixtures ---------------------------------------------------------------

const emptyBuilding = (): BuildingState => ({
  humans: {},
  operations: {
    f1: {
      operationId: "f1",
      name: "One",
      slug: "one",
      index: 1,
      paletteId: "teal-cream",
      henchmenWorking: 0,
      henchmenWaiting: 0,
      henchmenTotal: 0,
      humansPresent: 0,
      ...UNPLACED_ROOM,
      ...DEFAULT_ROOM_SETTINGS,
    },
  },
  chat: [],
  jukebox: { ...IDLE_JUKEBOX, current: { ...IDLE_JUKEBOX.current }, queue: [] },
  usage: {
    todayInputTokens: 0,
    todayOutputTokens: 0,
    todayCacheTokens: 0,
    todayCostUsdEstimate: 0,
    officeKeysCostUsdEstimate: 0,
    activeHumans: 0,
    topHenchmen: [],
    dayStart: 0,
    observedAt: 0,
  },
  pm: {
    enabled: false,
    privilege: "coordinator",
    activity: "idle",
    operationId: "lobby",
    position: { x: 0, z: 0, heading: 0 },
    animation: "idle",
    doing: "",
    targetAgentId: "",
    lastBriefAt: 0,
  },
  compound: EMPTY_COMPOUND,
  blastDoor: BLAST_DOOR_CLOSED,
  lobbyWhiteboardVersion: 0,
});

const emptyOperation = (operationId: string): OperationState => ({
  operationId,
  name: operationId,
  slug: operationId,
  paletteId: "teal-cream",
  layoutTemplateId: "small",
  repos: [],
  henchmen: {},
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
  operationRooms: FakeRoom<OperationState>[] = [];
  operationJoins: OperationJoinOptions[] = [];
  failBuildingJoins = 0;
  failOperationJoins = 0;
  /** Reject operation joins like the server does without operation access. */
  denyOperationJoins = false;
  /** Resolvers for joins that should stay pending until released. */
  holdOperationJoins = false;
  private pendingOperation: Array<() => void> = [];

  async joinBuilding() {
    if (this.failBuildingJoins > 0) {
      this.failBuildingJoins--;
      throw new Error("matchmake failed");
    }
    const room = new FakeRoom(emptyBuilding());
    this.buildingRooms.push(room);
    return room;
  }
  async joinOperation(options: OperationJoinOptions) {
    this.operationJoins.push(options);
    if (this.holdOperationJoins) await new Promise<void>((r) => this.pendingOperation.push(r));
    if (this.denyOperationJoins) throw Object.assign(new Error("access denied"), { code: 403 });
    if (this.failOperationJoins > 0) {
      this.failOperationJoins--;
      throw new Error("operation full");
    }
    const room = new FakeRoom(emptyOperation(options.operationId));
    this.operationRooms.push(room);
    return room;
  }
  releaseOperationJoins() {
    const pending = this.pendingOperation;
    this.pendingOperation = [];
    for (const r of pending) r();
  }
  get building() {
    return this.buildingRooms.at(-1) as FakeRoom<BuildingState>;
  }
  get operation() {
    return this.operationRooms.at(-1) as FakeRoom<OperationState>;
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
const stores = {
  building: useBuildingStore,
  operation: useOperationStore,
  connection: useConnectionStore,
};
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
  useOperationStore.getState().clear();
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
    expect(Object.keys(useBuildingStore.getState().state?.operations ?? {})).toEqual(["f1"]);

    transport.building.patch((s) => {
      s.chat.push({ id: "m1", userId: "u1", displayName: "A", operationId: "", text: "hi", ts: 1 });
    });
    expect(useBuildingStore.getState().state?.chat).toHaveLength(1);
  });

  test("joins exactly one operation at a time and patches the operation store", async () => {
    const { transport, client } = setup();
    await client.connect();
    await client.goToOperation("f1");
    expect(useOperationStore.getState().operationId).toBe("f1");
    transport.operation.patch((s) => {
      s.whiteboardVersion = 7;
    });
    expect(useOperationStore.getState().state?.whiteboardVersion).toBe(7);

    const first = transport.operation;
    await client.goToOperation("f2");
    expect(first.left).toEqual([true]);
    expect(transport.operationRooms).toHaveLength(2);
    expect(client.currentOperationId).toBe("f2");
    expect(useOperationStore.getState().state?.operationId).toBe("f2");

    await client.goToOperation("f2"); // no-op
    expect(transport.operationRooms).toHaveLength(2);
  });

  test("setRooms tells the building where we are; the lobby has no operation room", async () => {
    const { transport, client } = setup();
    await client.connect();
    await client.setRooms("f1");
    expect(transport.building.sent).toEqual([
      { type: "operation.go", payload: { operationId: "f1", mode: "teleport" } },
    ]);
    expect(client.currentOperationId).toBe("f1");
    const operationRoom = transport.operation;
    await client.setRooms(null);
    expect(operationRoom.left).toEqual([true]);
    expect(client.currentOperationId).toBeNull();
    expect(useOperationStore.getState().operationId).toBeNull();
    expect(transport.building.sent.at(-1)).toEqual({
      type: "operation.go",
      payload: { operationId: "lobby", mode: "teleport" },
    });
  });

  test("joins the current room and up to three nearby rooms, leaving the rest (#186)", async () => {
    const { transport, client } = setup();
    await client.connect();
    await client.setRooms("f1", ["f2", "f3", "f4", "f5"]);
    expect(transport.operationJoins.map((j) => j.operationId)).toEqual(["f1", "f2", "f3", "f4"]);
    expect(client.joinedOperationIds.sort()).toEqual(["f1", "f2", "f3", "f4"]);
    expect(Object.keys(useRoomsStore.getState().states).sort()).toEqual(["f1", "f2", "f3", "f4"]);
    // The HUD's operation store mirrors only the room we are in.
    expect(useOperationStore.getState().state?.operationId).toBe("f1");
    const [r1, r2, r3, r4] = transport.operationRooms;
    r2?.patch((s) => {
      s.whiteboardVersion = 3;
    });
    expect(useRoomsStore.getState().states.f2?.whiteboardVersion).toBe(3);
    expect(useOperationStore.getState().state?.whiteboardVersion).toBe(0);

    // Walking into f2: no new join, the HUD switches at once; f4 drops out of view.
    await client.setRooms("f2", ["f1", "f3"]);
    expect(transport.operationJoins).toHaveLength(4);
    expect(useOperationStore.getState().state?.operationId).toBe("f2");
    expect(useOperationStore.getState().state?.whiteboardVersion).toBe(3);
    expect(r4?.left).toEqual([true]);
    expect(useRoomsStore.getState().states.f4).toBeUndefined();
    expect([r1, r2, r3].map((r) => r?.left)).toEqual([[], [], []]);
    expect(
      transport.building.sent.map((m) => (m.payload as { operationId: string }).operationId),
    ).toEqual(["f1", "f2"]);
  });

  test("commands and messages follow the room we are in, not the nearby ones", async () => {
    const { transport, client } = setup();
    const seen: unknown[] = [];
    const rejected: string[] = [];
    client.onOperationMessage("agent.permissions", (p) => seen.push(p));
    client.onRejected((n) => rejected.push(n.type));
    await client.connect();
    await client.setRooms("f1", ["f2"]);
    const [r1, r2] = transport.operationRooms;
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

  test("a denied operation join is not retried", async () => {
    const { transport, clock, client } = setup();
    await client.connect();
    transport.denyOperationJoins = true;
    await client.goToOperation("f1");
    expect(clock.pendingDelays).toEqual([]);
    expect(useOperationStore.getState().operationId).toBeNull();
    expect(useConnectionStore.getState().lastError).toBe("access denied");
  });

  test("routes commands to the owning room and refuses when it is not joined", async () => {
    const { transport, client } = setup();
    await client.connect();
    client.send("chat", { text: "hello" });
    expect(transport.building.sent).toEqual([{ type: "chat", payload: { text: "hello" } }]);
    expect(() => client.send("agent.stop", { agentId: "a1" })).toThrow(/operation room not joined/);
    await client.goToOperation("f1");
    client.send("agent.stop", { agentId: "a1" });
    expect(transport.operation.sent).toEqual([{ type: "agent.stop", payload: { agentId: "a1" } }]);
  });

  test("forwards command.rejected notices from both rooms until unsubscribed", async () => {
    const { transport, client } = setup();
    const seen: CommandRejected[] = [];
    const off = client.onRejected((n) => seen.push(n));
    await client.connect();
    await client.goToOperation("f1");
    transport.building.reject({ type: "chat", reason: "invalid chat: text: too long" });
    transport.operation.reject({ type: "agent.spawn", reason: "forbidden" });
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

  test("operation messages reach listeners on the current and later operations, once each", async () => {
    const { transport, client } = setup();
    const seen: unknown[] = [];
    const off = client.onOperationMessage("agent.permissions", (p) => seen.push(p));
    await client.connect();
    await client.goToOperation("f1");
    transport.operation.message("agent.permissions", { agentId: "a1", requests: [] });
    const first = transport.operation;
    await client.goToOperation("f2");
    expect(first.listenerCount("agent.permissions")).toBe(0);
    transport.operation.message("agent.permissions", { agentId: "a2", requests: [] });
    client.onOperationMessage("agent.permissions", () => undefined);
    expect(transport.operation.listenerCount("agent.permissions")).toBe(1);
    off();
    transport.operation.message("agent.permissions", { agentId: "a3", requests: [] });
    expect(seen).toEqual([
      { agentId: "a1", requests: [] },
      { agentId: "a2", requests: [] },
    ]);
  });

  test("re-joins with exponential backoff when the building room is lost", async () => {
    const { transport, clock, client } = setup();
    await client.connect();
    await client.goToOperation("f1");

    transport.building.serverClose(1006, "socket died");
    expect(useConnectionStore.getState()).toMatchObject({ status: "reconnecting", attempt: 1 });
    expect(useBuildingStore.getState().state).toBeNull();
    expect(useOperationStore.getState().state).toBeNull();
    expect(clock.pendingDelays).toEqual([100]);

    transport.failBuildingJoins = 2;
    await clock.fireNext(); // attempt 1 fails -> attempt 2 scheduled at 200
    await clock.fireNext(); // attempt 2 fails -> attempt 3 scheduled at 400
    expect(clock.timers.map((t) => t.delay)).toEqual([100, 200, 400]);
    expect(useConnectionStore.getState().attempt).toBe(3);

    await clock.fireNext(); // succeeds, and the operation is re-joined
    expect(useConnectionStore.getState()).toMatchObject({ status: "connected", attempt: 0 });
    expect(transport.buildingRooms).toHaveLength(2);
    expect(transport.operationJoins.map((j) => j.operationId)).toEqual(["f1", "f1"]);
    expect(useOperationStore.getState().state?.operationId).toBe("f1");
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

  test("a lost operation room is re-joined on its own while the building stays connected", async () => {
    const { transport, clock, client } = setup();
    await client.connect();
    await client.goToOperation("f1");
    transport.operation.serverClose(1006);
    expect(useConnectionStore.getState().status).toBe("connected");
    expect(clock.pendingDelays).toEqual([100]);
    await clock.fireNext();
    expect(transport.operationRooms).toHaveLength(2);
    expect(useOperationStore.getState().state?.operationId).toBe("f1");
  });

  test("an operation join superseded by another room change is left immediately", async () => {
    const { transport, client } = setup();
    await client.connect();
    transport.holdOperationJoins = true;
    const p1 = client.goToOperation("f1");
    const p2 = client.goToOperation("f2");
    transport.holdOperationJoins = false;
    transport.releaseOperationJoins();
    await Promise.all([p1, p2]);
    const [r1, r2] = transport.operationRooms;
    expect(r1?.left).toEqual([true]);
    expect(r2?.left).toEqual([]);
    expect(client.currentOperationId).toBe("f2");
  });

  test("disconnect leaves both rooms consented and cancels pending retries", async () => {
    const { transport, clock, client } = setup();
    await client.connect();
    await client.goToOperation("f1");
    const operation = transport.operation;
    const building = transport.building;
    await client.disconnect();
    expect(operation.left).toEqual([true]);
    expect(building.left).toEqual([true]);
    expect(useConnectionStore.getState().status).toBe("disconnected");
    expect(clock.pendingDelays).toEqual([]);
    expect(useBuildingStore.getState().state).toBeNull();
  });

  // ---- access withdrawn while connected (#244) ----

  test("a room closed with `revoked` is not rejoined; the human is told once", async () => {
    const notices: AccessNotice[] = [];
    const { transport, clock, client } = setup({ onAccess: (n) => notices.push(n) });
    await client.connect();
    await client.goToOperation("f1");
    expect(transport.operationJoins).toHaveLength(1);

    transport.operation.serverClose(ACCESS_CLOSE_CODES.revoked, "access revoked");
    await flush();
    expect(clock.pendingDelays).toEqual([]);
    expect(transport.operationJoins).toHaveLength(1);
    expect(useOperationStore.getState().operationId).toBeNull();
    expect(notices).toEqual([
      { kind: "revoked", operationId: "f1", message: "You no longer have access to this room." },
    ]);
    // Still wanted, still refused: asking for the same rooms again does not knock again.
    await client.setRooms("f1", []);
    expect(transport.operationJoins).toHaveLength(1);
    // The office itself is untouched.
    expect(client.status).toBe("connected");
  });

  test("a nearby room closed with `revoked` goes quietly", async () => {
    const notices: AccessNotice[] = [];
    const { transport, client } = setup({ onAccess: (n) => notices.push(n) });
    await client.connect();
    await client.setRooms("f1", ["f2"]);
    const nearby = transport.operationRooms.find((r) => r.snapshot().operationId === "f2");
    nearby?.serverClose(ACCESS_CLOSE_CODES.revoked);
    await flush();
    expect(notices).toEqual([]);
    expect(client.joinedOperationIds).toEqual(["f1"]);
  });

  test("a room closed with `changed` is joined again at once, without a notice", async () => {
    const notices: AccessNotice[] = [];
    const { transport, clock, client } = setup({ onAccess: (n) => notices.push(n) });
    await client.connect();
    await client.goToOperation("f1");
    transport.operation.serverClose(ACCESS_CLOSE_CODES.changed, "access changed");
    await flush();
    expect(clock.pendingDelays).toEqual([]);
    expect(transport.operationJoins).toHaveLength(2);
    expect(client.currentOperationId).toBe("f1");
    expect(notices).toEqual([]);
  });

  test("signed out: the office stops instead of reconnecting, with a plain message", async () => {
    const notices: AccessNotice[] = [];
    const { transport, clock, client } = setup({ onAccess: (n) => notices.push(n) });
    await client.connect();
    await client.goToOperation("f1");
    transport.building.serverClose(ACCESS_CLOSE_CODES.signedOut, "signed out");
    await flush();
    expect(client.status).toBe("disconnected");
    expect(clock.pendingDelays).toEqual([]);
    expect(transport.buildingRooms).toHaveLength(1);
    expect(notices).toEqual([
      { kind: "signedOut", message: "You were signed out. Sign in again to continue." },
    ]);
    expect(useConnectionStore.getState().lastError).toBe(
      "You were signed out. Sign in again to continue.",
    );
  });

  test("the office role changed: the building is joined again at once", async () => {
    const notices: AccessNotice[] = [];
    const { transport, clock, client } = setup({ onAccess: (n) => notices.push(n) });
    await client.connect();
    await client.goToOperation("f1");
    transport.building.serverClose(ACCESS_CLOSE_CODES.changed, "access changed");
    await flush();
    await flush();
    expect(clock.pendingDelays).toEqual([]);
    expect(transport.buildingRooms).toHaveLength(2);
    expect(client.status).toBe("connected");
    expect(client.currentOperationId).toBe("f1");
    expect(notices).toEqual([]);
  });
});
