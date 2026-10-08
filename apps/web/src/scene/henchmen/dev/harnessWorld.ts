/**
 * The dev harness's compound (dev/office.html, #186, #190): the 12 × 12 Dev
 * room with every desk and three ordinary rooms, plus `rooms=<n>` more
 * 8 × 8 rooms auto-placed in the rows north of the main corridor (the §11
 * performance gate measures 12), and fake remote humans (`humans=<n>`, the
 * local player included) strolling round the Dev room. Not part of the build.
 */

import {
  ARCHETYPE_DEFAULTS,
  type BuildingState,
  DECOR_STYLES,
  GENIUS_ARCHETYPES,
  type HumanPresence,
} from "@regulus/protocol";
import { defaultCompoundSpec, findPlacement } from "@regulus/room-layout";
import { type TestRoom, testState, testWorld } from "../../compound/testing.ts";
import type { CompoundWorld } from "../../compound/world.ts";

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

/** The harness compound with `total` project rooms. */
export function harnessWorld(
  locked: readonly string[],
  building: readonly string[],
  total = BASE_ROOMS.length,
): CompoundWorld {
  const rooms = harnessRooms(Math.max(BASE_ROOMS.length, total));
  return testWorld(
    rooms.map((r) => ({ ...r, building: building.includes(r.id) })),
    rooms.map((r) => r.id).filter((id) => !locked.includes(id)),
    HARNESS_SIZE,
  );
}

const published = new Map<number, ReturnType<typeof testState>>();

/** The published BuildingState slice of the harness compound (remote humans read it). */
export function harnessBuilding(total: number, humans: Record<string, HumanPresence>) {
  const n = Math.max(BASE_ROOMS.length, total);
  // Placing rooms routes corridors: do it once per size, not on every tick.
  let state = published.get(n);
  if (!state) {
    state = testState(harnessRooms(n), HARNESS_SIZE);
    published.set(n, state);
  }
  return {
    compound: state.compound,
    operations: state.operations,
    humans,
    // The scene's jukebox driver reads this as soon as there is a building state.
    jukebox: { playing: false, queue: [], volume: 0, startedAtServerMs: 0, pausedAtMs: 0 },
    officeAgents: {},
  } as unknown as BuildingState;
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
      levelId: "lobby",
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
