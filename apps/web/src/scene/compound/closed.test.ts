/**
 * Closed rooms (SPEC §14 D26; #269): what the client is given for a room the
 * viewer may not enter (`BuildingState.closedRooms`, #270: id, level,
 * footprint, door, `closed: true`) and everything the scene derives from it.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { ClosedRoom, type OperationSummary } from "@regulus/protocol";
import { findWorldPath } from "@regulus/room-layout";
import { worldKey } from "../../state/compound.ts";
import {
  NO_ENTRY_EVERY_MS,
  NO_ENTRY_MESSAGE,
  NO_ENTRY_UNLINKED,
  noEntryMessage,
  refuseEntry,
  resetEntryNotice,
} from "../../state/entry.ts";
import { levelView } from "../../state/level.ts";
import { useUiStore } from "../../state/ui.ts";
import { travelRooms } from "../../ui/hud/QuickTravel.tsx";
import { BEHIND_CLOSED_DOOR, placeAt } from "../../ui/whereabouts/whereabouts.ts";
import { PIECES } from "../lair/kit.ts";
import { roomSeats } from "../social/seats.ts";
import { structureLists } from "./CompoundStructure.tsx";
import { closedRoomAt, closedRooms, NO_ENTRY_REACH, platePose, plateSide } from "./closed.ts";
import { roomArt, roomLook } from "./interiors.ts";
import { closedDoors, compoundNavGrid, navKey } from "./navigation.ts";
import { placeRoom } from "./placed.ts";
import { createPresenceMemory, pickRooms } from "./presence.ts";
import { NO_ENTRY_LINES, signLines } from "./signTexture.ts";
import { closedRoomOf, rowPlacement, testState } from "./testing.ts";
import {
  type CompoundWorld,
  compoundWorld,
  isOpenRoom,
  roomAt,
  travelPose,
  type WorldRoom,
} from "./world.ts";

const LEVEL = "lv-a";
const published = testState(
  [
    { id: "open", name: "Open", placement: rowPlacement(4), deskCount: 2 },
    {
      id: "vault",
      name: "Top secret",
      placement: rowPlacement(16),
      deskCount: 3,
      working: 2,
      waiting: 1,
    },
    { id: "crypt", name: "Also secret", placement: rowPlacement(28), working: 1 },
  ],
  48,
  { levelId: LEVEL, landing: true },
);
const entry = (id: string) => published.operations[id] as OperationSummary;

/**
 * The world as this viewer is given it: the rooms in `closed` are not in
 * `operations` at all, only in `closedRooms` (id, level, footprint, door).
 */
function worldWith(closed: Record<string, ClosedRoom>): CompoundWorld {
  const operations = { ...published.operations };
  for (const id of Object.keys(closed)) delete operations[id];
  const world = compoundWorld(
    { compound: published.compound, operations, closedRooms: Object.values(closed) },
    // Even a viewer whose REST list named the room does not get in while it is closed.
    new Set(["open", "vault", "crypt"]),
    LEVEL,
  );
  if (!world) throw new Error("no world");
  return world;
}
const world = worldWith({
  vault: closedRoomOf(entry("vault")),
  crypt: closedRoomOf(entry("crypt"), false),
});
const room = (id: string, w = world) => w.rooms.find((r) => r.id === id) as WorldRoom;

afterEach(() => resetEntryNotice());

describe("a closed room as the server sends it (protocol ClosedRoom, #270)", () => {
  test("is the id, the level, the footprint, the door and closed: true, and nothing else", () => {
    const sent = closedRoomOf(entry("vault"));
    expect(ClosedRoom.parse(sent)).toEqual(sent);
    expect(Object.keys(sent).sort()).toEqual(
      [
        "closed",
        "depth",
        "doorSide",
        "doorX",
        "doorY",
        "gridX",
        "gridY",
        "levelId",
        "operationId",
        "width",
      ].sort(),
    );
    expect(sent).toMatchObject({
      operationId: "vault",
      levelId: LEVEL,
      gridX: 16,
      gridY: 28,
      width: 8,
      depth: 8,
      closed: true,
    });
    expect(JSON.stringify(sent)).not.toContain("Top secret");
  });

  test("it reaches the world through the level's slice of the building state", () => {
    const state = {
      compound: published.compound,
      levels: { [LEVEL]: { compound: published.compound } },
      operations: { open: entry("open") },
      closedRooms: {
        vault: closedRoomOf(entry("vault")),
        // A closed room of another level is not on this level's map.
        other: { ...closedRoomOf(entry("crypt")), operationId: "other", levelId: "lv-b" },
      },
    } as unknown as Parameters<typeof levelView>[0];
    const view = levelView(state, LEVEL);
    expect(view?.closedRooms.map((r) => r.operationId)).toEqual(["vault"]);
    const built = compoundWorld(view, new Set(["open"]), LEVEL);
    expect(built?.rooms.map((r) => [r.id, r.closed])).toEqual([
      ["landing", false],
      ["open", false],
      ["vault", true],
    ]);
  });
});

describe("a closed room in the world", () => {
  test("keeps its footprint and nothing else", () => {
    for (const r of [room("vault")]) {
      expect(r).toMatchObject({
        id: "vault",
        kind: "project",
        name: "",
        closed: true,
        enterable: false,
        buildState: "ready",
        henchmenWorking: 0,
        henchmenWaiting: 0,
        henchmenTotal: 0,
        deskCount: 1,
        decorStyle: "ops_room",
        rect: { x: 16, y: 28, w: 8, d: 8 },
      });
      expect(isOpenRoom(r)).toBe(false);
    }
    expect(JSON.stringify(world.rooms)).not.toMatch(/secret/i);
    expect(room("open")).toMatchObject({ closed: false, enterable: true, name: "Open" });
  });

  test("a known door is kept (sealed shut); without one the room is solid rock", () => {
    expect(room("vault").sealed).toBe(false);
    expect(room("vault").door).toEqual({ x: entry("vault").doorX, y: entry("vault").doorY });
    expect(room("crypt").sealed).toBe(true);
    // A door that is not on the footprint's wall is not believed.
    const odd = worldWith({ vault: { ...closedRoomOf(entry("vault")), doorX: 3, doorY: 3 } });
    expect(room("vault", odd).sealed).toBe(true);
  });

  test("changes what is drawn and walked when a room closes or opens", () => {
    const open = worldWith({});
    expect(worldKey(open)).not.toBe(worldKey(world));
    expect(navKey(open)).not.toBe(navKey(world));
    expect(closedRooms(world).map((r) => r.id)).toEqual(["vault", "crypt"]);
    expect(closedRooms(open)).toEqual([]);
  });
});

describe("what is drawn of a closed room", () => {
  test("rock walls under the cap: no floor, lamps, furniture, laptops, boards or interior", () => {
    for (const id of ["vault", "crypt"]) {
      const r = room(id);
      expect(roomLook(r)).toBe("closed");
      const art = roomArt(r);
      expect(art.layout).toBeNull();
      expect(art.dressing).toBeNull();
      expect([
        art.laptops,
        art.looks,
        art.lamps,
        art.consoleLamps,
        art.beacons,
        art.obstacles,
      ]).toEqual([[], [], [], [], [], []]);
      const categories = new Set(art.pieces.map((p) => PIECES[p.piece].category));
      expect([...categories]).toEqual(["structure"]);
      expect(art.pieces.some((p) => p.piece.startsWith("floor_"))).toBe(false);
      // Drawn the same whether or not its OperationRoom were joined: it never is.
      const placed = [placeRoom(r)];
      const lists = structureLists(placed, [], new Set([id]), new Set(), new Map());
      expect(lists.looks).toEqual([]);
      expect(lists.consoleLamps).toEqual([]);
    }
  });

  test("a known door stands barred; an unknown one is not drawn at all", () => {
    const vault = roomArt(room("vault"));
    expect(vault.doors).toHaveLength(1);
    expect(vault.pieces.filter((p) => p.piece === "door_bars")).toHaveLength(1);
    const crypt = roomArt(room("crypt"));
    expect(crypt.doors).toEqual([]);
    expect(crypt.pieces.some((p) => p.piece === "door_bars")).toBe(false);
    // Walls all the way round: one more wall segment pair than the room with a door.
    const walls = (a: typeof vault) =>
      a.pieces.filter((p) => p.piece.startsWith("wall_rock")).length;
    expect(walls(crypt)).toBe(walls(vault) + 2);
  });

  test("the bars are on the corridor side of the door", () => {
    const r = room("vault");
    const bars = roomArt(r).pieces.find((p) => p.piece === "door_bars");
    if (!bars) throw new Error("no bars");
    // The door is in the south wall: the bars stand south of the room's footprint.
    expect(r.doorSide).toBe("south");
    expect(bars.position[2]).toBeGreaterThan(r.size.d);
  });

  test("one neutral plate, the same for every closed room", () => {
    expect(NO_ENTRY_LINES).toEqual({ title: "NO ENTRY", status: "RESTRICTED AREA" });
    // The name plaque's text would have said more: it is not used for closed rooms.
    expect(
      signLines({ name: "Top secret", working: 2, waiting: 1, building: false, locked: true })
        .title,
    ).toBe("Top secret");
    const vault = platePose(room("vault"), world);
    expect(vault.side).toBe("south");
    expect(vault.position[2]).toBeGreaterThan(room("vault").origin.z + room("vault").size.d);
    // Rock only: the plate hangs on the wall the corridor runs along.
    const crypt = platePose(room("crypt"), world);
    expect(plateSide(room("crypt"), world.corridors)).toBe("south");
    expect(crypt.position[0]).toBeCloseTo(room("crypt").origin.x + room("crypt").size.w / 2, 5);
    expect(plateSide(room("crypt"), [])).toBe("south");
    const east = {
      x: room("crypt").rect.x + room("crypt").rect.w,
      y: room("crypt").rect.y,
      w: 2,
      d: 2,
    };
    expect(plateSide(room("crypt"), [east])).toBe("east");
  });
});

describe("nothing gets in or out of a closed room", () => {
  test("the nav grid keeps it shut and nobody is ever walked into it", () => {
    expect([...closedDoors(world)].sort()).toEqual(["crypt", "vault"]);
    const grid = compoundNavGrid(world);
    for (const id of ["vault", "crypt"]) {
      const r = room(id);
      const inside = { x: r.origin.x + r.size.w / 2, z: r.origin.z + r.size.d / 2 };
      const door = travelPose(room("vault"));
      expect(findWorldPath(grid, door, inside)).toBeNull();
    }
    const open = room("open");
    const inOpen = { x: open.origin.x + open.size.w / 2, z: open.origin.z + 2 };
    expect(findWorldPath(grid, travelPose(open), inOpen)).not.toBeNull();
  });

  test("its OperationRoom is never joined: no henchmen, boards, screens or sounds", () => {
    const all = new Set(world.rooms.map((r) => r.id));
    const vault = room("vault");
    const inside = { x: vault.origin.x + 4, z: vault.origin.z + 4 };
    const atDoor = travelPose(vault);
    for (const p of [inside, atDoor]) {
      const pick = pickRooms(world, p, all, createPresenceMemory(), 0);
      expect(pick.current).toBeNull();
      expect(pick.nearby).toEqual(["open"]);
    }
  });

  test("it offers no seats, is not in quick travel and has no name in who's where", () => {
    expect(roomSeats(room("vault"))).toEqual([]);
    expect(travelRooms(world.rooms).map((r) => r.id)).toEqual(["landing", "open"]);
    const v = room("vault");
    expect(placeAt(world, v.origin.x + 4, v.origin.z + 4)).toEqual({
      label: BEHIND_CLOSED_DOOR,
      zone: "room",
      roomId: "vault",
    });
    expect(roomAt(world, v.origin.x + 4, v.origin.z + 4)?.name).toBe("");
  });
});

describe("trying to go in", () => {
  test("E at the door or the plate finds the closed room; elsewhere it does not", () => {
    const vault = platePose(room("vault"), world);
    expect(closedRoomAt(world, vault.stand)?.id).toBe("vault");
    expect(
      closedRoomAt(world, { x: vault.stand.x, z: vault.stand.z + NO_ENTRY_REACH + 0.5 }),
    ).toBeNull();
    expect(closedRoomAt(world, travelPose(room("open")))).toBeNull();
    expect(closedRoomAt(world, platePose(room("crypt"), world).stand)?.id).toBe("crypt");
  });

  test("the answer is one plain sentence that names nothing, said once at a time", () => {
    useUiStore.setState({ toastQueue: { ...useUiStore.getState().toastQueue, toasts: [] } });
    expect(refuseEntry(1000)).toBe(true);
    expect(refuseEntry(1000 + NO_ENTRY_EVERY_MS - 1)).toBe(false);
    expect(refuseEntry(1000 + NO_ENTRY_EVERY_MS)).toBe(true);
    const toasts = useUiStore.getState().toastQueue.toasts;
    expect(toasts.map((t) => [t.kind, t.title, t.message])).toEqual([
      ["error", "No entry", NO_ENTRY_MESSAGE],
      ["error", "No entry", NO_ENTRY_MESSAGE],
    ]);
    expect(NO_ENTRY_MESSAGE).toStartWith("No entry.");
    // Someone who has not linked GitHub is told that instead: it is about them, not the room.
    expect(noEntryMessage("linked")).toBe(NO_ENTRY_MESSAGE);
    expect(noEntryMessage(undefined)).toBe(NO_ENTRY_MESSAGE);
    expect(noEntryMessage("unlinked")).toBe(NO_ENTRY_UNLINKED);
    expect(noEntryMessage("revoked")).toBe(NO_ENTRY_UNLINKED);
    expect(NO_ENTRY_MESSAGE).not.toMatch(/secret|vault|henchm|repo name/i);
  });
});
