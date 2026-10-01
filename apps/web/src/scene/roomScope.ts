/**
 * Which room a floor layer draws (#186). In the compound a client is in up
 * to four FloorRooms at once; each joined room's robots, laptops, boards,
 * queue clipboard and gong are drawn inside a group at the room's origin,
 * from that room's floor store. Only the room the player is in is
 * `interactive` (clicks, `E`, live screens): the HUD and every floor command
 * act on that room. Without a provider (dev harnesses, tests) a layer draws
 * the floor store at the world origin, interactive, as before.
 */
import { createContext, useContext } from "react";
import { useFloorStore } from "../state/floor.ts";
import { usePlayerStore } from "../state/player.ts";
import type { FloorStoreHook } from "../state/rooms.ts";

export interface RoomScope {
  /** The room's floor id; null for the default scope. */
  floorId: string | null;
  /** The room's north-west corner, compound metres. */
  origin: { x: number; z: number };
  /** The room the player is in (clicks, hotkeys and live screens). */
  interactive: boolean;
  /** The room's FloorRoom state. */
  store: FloorStoreHook;
  /**
   * Extra depth for wall-hung objects (`anchorPlacement`'s `depth`), so boards,
   * the clipboard and the gong stand clear of a rough lair wall's relief.
   */
  wallDepth: number;
}

export const DEFAULT_ROOM_SCOPE: RoomScope = {
  floorId: null,
  origin: { x: 0, z: 0 },
  interactive: true,
  store: useFloorStore,
  wallDepth: 0,
};

export const RoomScopeContext = createContext<RoomScope>(DEFAULT_ROOM_SCOPE);

export function useRoomScope(): RoomScope {
  return useContext(RoomScopeContext);
}

/** A point in compound metres in the room's frame. */
export function toRoom<T extends { x: number; z: number }>(scope: RoomScope, p: T): T {
  return { ...p, x: p.x - scope.origin.x, z: p.z - scope.origin.z };
}

/** The local player in the room's frame. */
export function playerInRoom(scope: RoomScope) {
  return toRoom(scope, usePlayerStore.getState());
}

/** Walk the player to a point given in the room's frame. */
export function walkInRoom(scope: RoomScope, x: number, z: number): boolean {
  return usePlayerStore.getState().setTarget(x + scope.origin.x, z + scope.origin.z);
}

/** Object names stay unique across rooms: rooms other than the player's get a prefix. */
export function scopedName(scope: RoomScope, name: string): string {
  return scope.interactive || !scope.floorId ? name : `${scope.floorId}:${name}`;
}
