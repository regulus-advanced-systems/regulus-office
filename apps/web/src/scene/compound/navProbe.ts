/**
 * The navigation probe (#186, #205), published on `window.__regulusNav` only
 * when the page is opened with `?stats` (like `__regulusR3F`): the e2e
 * flows read where the player is and which room they are in, and walk by
 * nav state instead of screen points. `walkTo` does what a floor click does;
 * `walkToSeat` walks up behind a desk's chair; `terminalDesk`
 * is the desk `E` would open (the same rule the live laptop panel uses).
 */
import { cameraView, useCameraStore } from "../../state/camera.ts";
import { useFloorStore } from "../../state/floor.ts";
import { usePlayerStore } from "../../state/player.ts";
import { terminalDeskAt } from "../laptops/focus.ts";
import { roomArt } from "./interiors.ts";
import { roomLayout } from "./layouts.ts";
import { type CompoundWorld, roomAt, roomById } from "./world.ts";

export interface NavProbe {
  pose(): {
    x: number;
    z: number;
    heading: number;
    spawned: boolean;
    walking: boolean;
    /** Room under the player (floor id, or a special room's id), null in a corridor. */
    room: string | null;
    /** The FloorRoom the HUD shows (the project room the player is in). */
    floorId: string | null;
  };
  rooms(): Array<{
    id: string;
    name: string;
    kind: string;
    enterable: boolean;
    buildState: string;
    x: number;
    z: number;
    w: number;
    d: number;
    /** A walkable point just inside the door (a special room's middle). */
    inside: { x: number; z: number };
  }>;
  /** A seat's position in compound metres, or null. */
  seat(floorId: string, seatId: string): { x: number; z: number } | null;
  walkTo(x: number, z: number): boolean;
  walkToSeat(floorId: string, seatId: string): boolean;
  /** The occupied desk `E` opens the terminal of, here and now (#205). */
  terminalDesk(): string | null;
  /** The 3/4 camera: the yaw and zoom it shows and the ones asked for (radians, 0..1). */
  camera(): { yaw: number; wantYaw: number; zoom: number; wantZoom: number; distance: number };
}

declare global {
  interface Window {
    __regulusNav?: NavProbe;
  }
}

/** How far behind a desk chair `walkToSeat` stands, metres. */
export const STAND_BEHIND = 0.8;

export function createNavProbe(getWorld: () => CompoundWorld | null): NavProbe {
  const seatOf = (floorId: string, seatId: string, behind = 0) => {
    const world = getWorld();
    const room = world ? roomById(world, floorId) : undefined;
    const layout = room ? roomArt(room).layout : null;
    const seat = layout?.seats.find((s) => s.id === seatId);
    if (!room || !seat) return null;
    // A seat faces its table along -(sin h, cos h); `behind` steps back from the chair.
    const h = seat.pose.heading;
    return {
      x: room.origin.x + seat.pose.x + Math.sin(h) * behind,
      z: room.origin.z + seat.pose.z + Math.cos(h) * behind,
    };
  };
  return {
    pose() {
      const p = usePlayerStore.getState();
      const world = getWorld();
      return {
        x: p.x,
        z: p.z,
        heading: p.heading,
        spawned: p.spawned,
        walking: p.path !== null,
        room: world ? (roomAt(world, p.x, p.z)?.id ?? null) : null,
        floorId: useFloorStore.getState().floorId,
      };
    },
    rooms() {
      return (getWorld()?.rooms ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        enterable: r.enterable,
        buildState: r.buildState,
        x: r.origin.x,
        z: r.origin.z,
        w: r.size.w,
        d: r.size.d,
        inside: (() => {
          const spawn = r.kind === "project" ? roomLayout(r)?.spawn : undefined;
          return spawn
            ? { x: r.origin.x + spawn.x, z: r.origin.z + spawn.z }
            : { x: r.origin.x + r.size.w / 2, z: r.origin.z + r.size.d / 2 };
        })(),
      }));
    },
    seat: (floorId, seatId) => seatOf(floorId, seatId),
    walkTo: (x, z) => usePlayerStore.getState().setTarget(x, z),
    walkToSeat(floorId, seatId) {
      // Just behind the chair, where someone stands to look over the sitter's shoulder.
      const at = seatOf(floorId, seatId, STAND_BEHIND);
      return at ? usePlayerStore.getState().setTarget(at.x, at.z) : false;
    },
    camera() {
      const want = useCameraStore.getState();
      return {
        yaw: cameraView.yaw,
        wantYaw: want.yaw,
        zoom: cameraView.zoom,
        wantZoom: want.zoom,
        distance: cameraView.distance,
      };
    },
    terminalDesk() {
      const world = getWorld();
      const floor = useFloorStore.getState();
      const room = world && floor.floorId ? roomById(world, floor.floorId) : undefined;
      const layout = room ? roomArt(room).layout : null;
      if (!room || !layout || !floor.state) return null;
      const p = usePlayerStore.getState();
      const busy = new Set(Object.values(floor.state.robots).map((r) => r.seatId));
      const seat = terminalDeskAt(
        layout.seats,
        { x: p.x - room.origin.x, z: p.z - room.origin.z },
        (id) => busy.has(id),
      );
      return seat?.id ?? null;
    },
  };
}
