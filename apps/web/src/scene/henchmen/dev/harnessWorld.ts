/**
 * The dev harness's lair (dev/office.html, #186, #190, #269). Three levels:
 * - the lobby level (the lobby, war room, break room, blast door and beach);
 * - "Regulus Advanced Systems", an organisation's level: the 12 × 12 Dev room
 *   with every desk and three ordinary rooms, plus `rooms=<n>` more 8 × 8
 *   rooms auto-placed in the rows north of the main corridor (the §11
 *   performance gate measures 12);
 * - "Ante", a personal account's level: two rooms the viewer may enter and
 *   two closed ones (`closed=<ids>`; the fixture for the shape agreed with
 *   #270: one with its door known, drawn sealed, one without, drawn as rock);
 * and, with `holding=1`, the holding level with one room that has no repo.
 * Fake remote humans (`humans=<n>`, the local player included) stroll round
 * the Dev room. Not part of the build.
 */

import {
  ARCHETYPE_DEFAULTS,
  type BuildingState,
  DECOR_STYLES,
  GENIUS_ARCHETYPES,
  HOLDING_LEVEL_ID,
  type HumanPresence,
  type LevelState,
  LOBBY_LEVEL_ID,
  type OperationSummary,
} from "@regulus/protocol";
import { buildingFixture } from "@regulus/protocol/src/fixtures.ts";
import { defaultCompoundSpec, findPlacement } from "@regulus/room-layout";
import { closedEntry, type TestRoom, testState } from "../../compound/testing.ts";

export const HARNESS_SIZE = 64;
export const DEV_ROOM = "dev";

const BASE_ROOMS: TestRoom[] = [
  {
    id: DEV_ROOM,
    name: "Dev",
    placement: { gridX: 26, gridY: 42, width: 12, depth: 12, doorSide: "south" },
    deskCount: 13,
  },
  {
    id: "apollo",
    name: "Apollo",
    placement: { gridX: 42, gridY: 46, width: 8, depth: 8, doorSide: "south" },
    deskCount: 2,
    decorStyle: "lab",
  },
  {
    id: "hermes",
    name: "Hermes",
    placement: { gridX: 12, gridY: 44, width: 10, depth: 10, doorSide: "south" },
    deskCount: 3,
    decorStyle: "workshop",
  },
  {
    id: "zeus",
    name: "Zeus",
    placement: { gridX: 54, gridY: 44, width: 8, depth: 10, doorSide: "south" },
    deskCount: 3,
    decorStyle: "war_room",
  },
];

const EXTRA_NAMES = ["Athena", "Ares", "Hera", "Iris", "Kronos", "Nyx", "Rhea", "Selene"];

/** The harness's project rooms: the four fixed ones, then up to `total` with auto-placed extras. */
export function harnessRooms(total: number): TestRoom[] {
  const rooms = [...BASE_ROOMS];
  const spec = defaultCompoundSpec(HARNESS_SIZE);
  for (let i = 0; rooms.length < total && i < EXTRA_NAMES.length; i++) {
    const id = (EXTRA_NAMES[i] ?? `room${i}`).toLowerCase();
    const placed = rooms.map((r) => ({ id: r.id, placement: r.placement }));
    const placement = findPlacement(spec, placed, id, { width: 8, depth: 8 });
    if (!placement) break;
    rooms.push({
      id,
      name: EXTRA_NAMES[i],
      placement,
      deskCount: 1 + (i % 3),
      decorStyle: DECOR_STYLES[i % DECOR_STYLES.length],
      working: i % 4,
      waiting: i % 3 === 0 ? 1 : 0,
    });
  }
  return rooms;
}

/** The harness's levels besides the lobby level. */
export const REGULUS_LEVEL = "lv-regulus";
export const ANTE_LEVEL = "lv-ante";

const south = (gridX: number, width: number, depth: number) => ({
  gridX,
  gridY: 54 - depth,
  width,
  depth,
  doorSide: "south" as const,
});

/** The account level's rooms: two the viewer has, two they have not. */
const ANTE_ROOMS: TestRoom[] = [
  { id: "dotfiles", name: "Dotfiles", placement: south(22, 8, 8), deskCount: 2 },
  { id: "vault", name: "Vault", placement: south(34, 10, 8), deskCount: 3, working: 2 },
  { id: "crypt", name: "Crypt", placement: south(8, 8, 8), deskCount: 2, waiting: 1 },
  {
    id: "sideproject",
    name: "Side project",
    placement: south(48, 8, 10),
    deskCount: 2,
    decorStyle: "workshop",
    working: 1,
  },
];
/** Closed by default (`closed=` overrides): `vault` keeps its door, `crypt` is all rock. */
export const DEFAULT_CLOSED = ["vault", "crypt"];
const ROCK_ONLY = new Set(["crypt"]);

export interface HarnessOptions {
  /** Project rooms on the organisation's level (4..12). */
  rooms: number;
  /** Rooms the viewer is no member of (the old "locked" look: name and counts stay). */
  locked: readonly string[];
  building: readonly string[];
  /** Rooms sent as closed (#270's shape): footprint only. */
  closed: readonly string[];
  /** Also publish the holding level, with one room. */
  holding: boolean;
}

/** Everything else the scene reads from the building state, quiet: no music, the door shut. */
const QUIET: Omit<BuildingState, "compound" | "levels" | "operations" | "humans"> = {
  chat: [],
  jukebox: { ...buildingFixture.jukebox, playing: false, queue: [] },
  usage: buildingFixture.usage,
  pm: { ...buildingFixture.pm, enabled: false },
  blastDoor: { phase: "closed", openedAt: 0, closesAt: 0, openedBy: "", presses: 0 },
  lobbyWhiteboardVersion: 0,
};

export interface HarnessLair {
  state: Omit<BuildingState, "humans">;
  /** Rooms the viewer may enter (the REST operation list). */
  enterable: string[];
}

const cache = new Map<string, HarnessLair>();

/** The harness's published levels and rooms; routed once per set of options. */
export function harnessLair(options: HarnessOptions): HarnessLair {
  const key = JSON.stringify(options);
  const hit = cache.get(key);
  if (hit) return hit;
  const lobby = testState([], HARNESS_SIZE);
  const mark = (rooms: TestRoom[]) =>
    rooms.map((r) => ({ ...r, building: options.building.includes(r.id) }));
  const regulusRooms = harnessRooms(Math.max(BASE_ROOMS.length, options.rooms));
  const parts: Array<{ info: Omit<LevelState, "compound">; rooms: TestRoom[] }> = [
    {
      info: {
        levelId: REGULUS_LEVEL,
        kind: "org",
        login: "regulus-advanced-systems",
        name: "Regulus Advanced Systems",
        order: 1,
      },
      rooms: regulusRooms,
    },
    {
      info: { levelId: ANTE_LEVEL, kind: "account", login: "antepante", name: "Ante", order: 2 },
      rooms: ANTE_ROOMS,
    },
  ];
  if (options.holding)
    parts.push({
      info: {
        levelId: HOLDING_LEVEL_ID,
        kind: "holding",
        login: "",
        name: "Unassigned",
        order: 65535,
      },
      rooms: [{ id: "scratch", name: "Scratch", placement: south(26, 8, 8) }],
    });
  const levels: Record<string, LevelState> = {
    [LOBBY_LEVEL_ID]: {
      levelId: LOBBY_LEVEL_ID,
      kind: "lobby",
      login: "",
      name: "Lobby",
      order: 0,
      compound: lobby.compound,
    },
  };
  const operations: Record<string, OperationSummary> = { ...lobby.operations };
  const enterable: string[] = [];
  for (const { info, rooms } of parts) {
    const level = testState(mark(rooms), HARNESS_SIZE, { levelId: info.levelId, landing: true });
    levels[info.levelId] = { ...info, compound: level.compound };
    for (const room of rooms) {
      const entry = level.operations[room.id];
      if (!entry) continue;
      const closed = options.closed.includes(room.id);
      operations[room.id] = closed ? closedEntry(entry, !ROCK_ONLY.has(room.id)) : entry;
      if (!closed && !options.locked.includes(room.id)) enterable.push(room.id);
    }
  }
  const lair = { state: { ...QUIET, compound: lobby.compound, levels, operations }, enterable };
  cache.set(key, lair);
  return lair;
}

/**
 * `count - 1` remote humans (the local player is the first human) walking
 * slow circles round a point in compound metres, one archetype each.
 */
export function fakeHumans(
  count: number,
  centre: { x: number; z: number },
  t: number,
): Record<string, HumanPresence> {
  const out: Record<string, HumanPresence> = {};
  for (let i = 1; i < count; i++) {
    const archetype = GENIUS_ARCHETYPES[i % GENIUS_ARCHETYPES.length] ?? "mastermind";
    const phase = (i / Math.max(1, count - 1)) * Math.PI * 2 + t * 0.25;
    const r = 3 + i;
    const id = `h${i}`;
    out[id] = {
      sessionId: id,
      levelId: REGULUS_LEVEL,
      userId: `u${i}`,
      displayName: ["Mia", "Olga", "Linus", "Ada", "Ben"][i - 1] ?? `Human ${i}`,
      role: "member",
      avatar: { ...ARCHETYPE_DEFAULTS[archetype], skin: "tan", hair: "black" },
      operationId: DEV_ROOM,
      position: {
        x: centre.x + Math.cos(phase) * r,
        z: centre.z + Math.sin(phase) * r * 0.6,
        heading: -phase,
      },
      animation: "walk",
      doing: "",
      seatId: "",
      sharingScreen: false,
      joinedAt: 1_700_000_000_000,
    };
  }
  return out;
}
