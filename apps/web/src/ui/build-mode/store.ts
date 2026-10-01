/**
 * Build mode's state (#187): what is being placed (a new project room, or a
 * room being moved), its size and door, where the ghost is, the server's
 * answer for that spot, and the room the camera is watching being built.
 *
 * While build mode is open it holds the `build-mode` overlay, so walking,
 * the global hotkeys and cursor-facing pause; its own keys (arrows, R,
 * Enter, Escape, Z/C) are handled by useBuildModeKeys.
 *
 * The create request (name, palette, repos and any typed repo token) is
 * kept in memory only between "Choose a spot…" and the confirm or cancel,
 * then dropped.
 */
import type { DoorSide, PlacementError, PlaceRoomRequest, RoomPlacement } from "@regulus/protocol";
import { create } from "zustand";
import type { CompoundWorld } from "../../scene/compound/world.ts";
import { useCameraStore } from "../../state/camera.ts";
import { useUiStore } from "../../state/ui.ts";
import {
  clampGhost,
  DEFAULT_PRESET,
  placementKey,
  placementOf,
  type RoomSize,
  rotateDoor,
  SIZE_PRESETS,
  suggestSpot,
  type TilePos,
} from "./logic.ts";

export const BUILD_MODE_OVERLAY = "build-mode";

export type BuildIntent =
  | { kind: "create"; request: Omit<PlaceRoomRequest, "placement"> }
  | { kind: "move"; floorId: string; name: string };

export interface ServerCheck {
  key: string;
  ok: boolean;
  reason?: PlacementError;
  conflicts: string[];
}

/** Camera framing while placing: the built compound plus room to build around it. */
export interface BuildFrame {
  centre: { x: number; z: number };
  extent: number;
}

export interface BuildModeState {
  intent: BuildIntent | null;
  size: RoomSize;
  doorSide: DoorSide;
  ghost: TilePos;
  /** Clicked or nudged into place: the cursor no longer drags it. */
  pinned: boolean;
  server: ServerCheck | null;
  busy: boolean;
  error: string | null;
  frame: BuildFrame | null;
  /** The zoom to go back to after placing and building. */
  returnZoom: number | null;
  /** A room just placed: the camera stays out until it is built, then zooms back. */
  watching: string | null;
  /** A room just moved: once it stands at `placement`, the mover goes to its door. */
  followMove: { floorId: string; placement: RoomPlacement } | null;
  /** The room just placed, whose status panel ("Floor added") is open. */
  added: string | null;

  start(world: CompoundWorld, intent: BuildIntent, frame: BuildFrame): void;
  setSize(world: CompoundWorld, size: RoomSize): void;
  setDoor(side: DoorSide): void;
  rotate(dir?: 1 | -1): void;
  /** The cursor is over this spot (ignored while pinned). */
  hover(world: CompoundWorld, pos: TilePos): void;
  pinAt(world: CompoundWorld, pos: TilePos): void;
  nudge(world: CompoundWorld, step: TilePos): void;
  setServer(check: ServerCheck): void;
  setBusy(busy: boolean, error?: string | null): void;
  /** Leave build mode; `placed` keeps the overview while the new room is built. */
  finish(result?: { placed?: string; moved?: { floorId: string; placement: RoomPlacement } }): void;
  cancel(): void;
  stopWatching(): void;
  closeAdded(): void;
  /** The ghost as a placement request. */
  placement(): RoomPlacement;
}

const DEFAULT_SIZE = SIZE_PRESETS[DEFAULT_PRESET];

export const useBuildModeStore = create<BuildModeState>()((set, get) => ({
  intent: null,
  size: { w: DEFAULT_SIZE.w, d: DEFAULT_SIZE.d },
  doorSide: "south",
  ghost: { x: 0, y: 0 },
  pinned: false,
  server: null,
  busy: false,
  error: null,
  frame: null,
  returnZoom: null,
  watching: null,
  followMove: null,
  added: null,

  start: (world, intent, frame) => {
    let size: RoomSize = { w: DEFAULT_SIZE.w, d: DEFAULT_SIZE.d };
    let doorSide: DoorSide = "south";
    let ghost: TilePos = { x: Math.floor(world.width / 2 - size.w / 2), y: 0 };
    if (intent.kind === "move") {
      const room = world.rooms.find((r) => r.id === intent.floorId);
      if (room) {
        size = { w: room.rect.w, d: room.rect.d };
        doorSide = room.doorSide;
        ghost = { x: room.rect.x, y: room.rect.y };
      }
    } else {
      ghost = suggestSpot(world, size) ?? ghost;
    }
    const camera = useCameraStore.getState();
    const s = get();
    set({
      intent,
      size,
      doorSide,
      ghost: clampGhost(world, ghost, size),
      // The ghost follows the mouse until a click (or an arrow key) holds it.
      pinned: false,
      server: null,
      busy: false,
      error: null,
      frame,
      returnZoom: s.watching ? s.returnZoom : (s.returnZoom ?? camera.zoom),
      added: null,
    });
    camera.setZoom(1);
    useUiStore.getState().openOverlay(BUILD_MODE_OVERLAY);
  },
  setSize: (world, size) => {
    const s = get();
    // Keep the room's middle where it was.
    const cx = s.ghost.x + s.size.w / 2;
    const cy = s.ghost.y + s.size.d / 2;
    const ghost = clampGhost(
      world,
      { x: Math.round(cx - size.w / 2), y: Math.round(cy - size.d / 2) },
      size,
    );
    set({ size, ghost, error: null });
  },
  setDoor: (doorSide) => set({ doorSide, error: null }),
  rotate: (dir = 1) => set((s) => ({ doorSide: rotateDoor(s.doorSide, dir), error: null })),
  hover: (world, pos) => {
    if (get().pinned) return;
    const ghost = clampGhost(world, pos, get().size);
    const g = get().ghost;
    if (ghost.x !== g.x || ghost.y !== g.y) set({ ghost, error: null });
  },
  pinAt: (world, pos) =>
    set({ ghost: clampGhost(world, pos, get().size), pinned: true, error: null }),
  nudge: (world, step) => {
    const g = get().ghost;
    set({
      ghost: clampGhost(world, { x: g.x + step.x, y: g.y + step.y }, get().size),
      pinned: true,
      error: null,
    });
  },
  setServer: (server) => set({ server }),
  setBusy: (busy, error = null) => set({ busy, error }),
  finish: (result = {}) => {
    const s = get();
    set({
      intent: null,
      busy: false,
      error: null,
      server: null,
      frame: null,
      watching: result.placed ?? s.watching,
      added: result.placed ?? null,
      followMove: result.moved ?? null,
    });
    useUiStore.getState().closeOverlay(BUILD_MODE_OVERLAY);
    if (!result.placed && !s.watching) get().stopWatching();
  },
  cancel: () => get().finish(),
  stopWatching: () => {
    const zoom = get().returnZoom;
    set({ watching: null, returnZoom: null });
    if (zoom !== null) useCameraStore.getState().setZoom(zoom);
  },
  closeAdded: () => set({ added: null }),
  placement: () => {
    const s = get();
    return placementOf(s.ghost, s.size, s.doorSide);
  },
}));

/** The key of the ghost's current placement (what the server check answers). */
export function ghostKey(s: Pick<BuildModeState, "ghost" | "size" | "doorSide">): string {
  return placementKey(placementOf(s.ghost, s.size, s.doorSide));
}

/** e2e probe (`?stats`): build mode as the tests read it. */
export function buildProbe() {
  const s = useBuildModeStore.getState();
  return {
    active: s.intent !== null,
    kind: s.intent?.kind ?? null,
    placement: s.intent ? s.placement() : null,
    pinned: s.pinned,
    server: s.server,
    watching: s.watching,
  };
}
