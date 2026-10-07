/**
 * Per-frame bookkeeping of the compound scene (#186), throttled:
 * - `Culling`: which rooms and corridor chunks the camera sees (4×/s);
 * - `RoomPresence`: which OperationRooms to be in (the room the player stands
 *   in plus up to three nearest visible rooms, presence.ts), handed to the
 *   office client whenever the pick changes.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { cameraView } from "../../state/camera.ts";
import { useConnectionStore } from "../../state/connection.ts";
import { useLevelStore } from "../../state/level.ts";
import { usePlayerStore } from "../../state/player.ts";
import type { CorridorChunk } from "./corridors.ts";
import type { Bounds, PlacedRoom } from "./placed.ts";
import { createPresenceMemory, pickRooms, type RoomPick, samePick } from "./presence.ts";
import { presetOf, useQualityStore } from "./quality.ts";
import { FAR_DISTANCE, frustumOf, sameSet, useVisibleStore, visibleIds } from "./visibility.ts";
import type { CompoundWorld } from "./world.ts";

const CULL_S = 0.25;

/** Boxes within `radius` metres of the player (ground distance to the box). */
function nearPlayer(radius: number) {
  const p = usePlayerStore.getState();
  return (b: { bounds: Bounds }) => {
    const dx = Math.max(b.bounds.minX - p.x, 0, p.x - b.bounds.maxX);
    const dz = Math.max(b.bounds.minZ - p.z, 0, p.z - b.bounds.maxZ);
    return Math.hypot(dx, dz) <= radius;
  };
}
const PRESENCE_S = 0.4;

export function Culling({
  rooms,
  chunks,
}: {
  rooms: readonly PlacedRoom[];
  chunks: readonly CorridorChunk[];
}) {
  const camera = useThree((s) => s.camera);
  const since = useRef(Number.POSITIVE_INFINITY);
  const roomBoxes = useMemo(() => rooms.map((r) => ({ id: r.room.id, bounds: r.bounds })), [rooms]);
  const chunkBoxes = useMemo(
    () =>
      chunks.map((c) => ({
        id: c.key,
        bounds: { minX: c.minX, minZ: c.minZ, maxX: c.maxX, maxZ: c.maxZ },
      })),
    [chunks],
  );
  // A new world: look again at once.
  useEffect(() => {
    since.current = Number.POSITIVE_INFINITY;
  }, [roomBoxes, chunkBoxes]);
  useFrame((state, dt) => {
    since.current += dt;
    if (since.current < CULL_S) return;
    since.current = 0;
    const cam = state.camera ?? camera;
    cam.updateMatrixWorld();
    const frustum = frustumOf(cam);
    // The low tier only draws what is near the player (quality.ts).
    const reach = presetOf(useQualityStore.getState().quality).drawDistance;
    const near = reach === null ? undefined : nearPlayer(reach);
    const nextRooms = visibleIds(frustum, near ? roomBoxes.filter(near) : roomBoxes);
    const nextChunks = visibleIds(frustum, near ? chunkBoxes.filter(near) : chunkBoxes);
    const now = useVisibleStore.getState();
    const far = cameraView.distance > (now.far ? FAR_DISTANCE * 0.9 : FAR_DISTANCE);
    if (!sameSet(now.rooms, nextRooms) || !sameSet(now.chunks, nextChunks) || far !== now.far)
      now.set({ rooms: nextRooms, chunks: nextChunks, far });
  });
  return null;
}

export interface PresenceTarget {
  setRooms(current: string | null, nearby: readonly string[]): Promise<void>;
  /** The level the player is on (#268); absent in harnesses with one level. */
  setLevel?(levelId: string): void;
}

export function RoomPresence({
  world,
  target,
}: {
  world: CompoundWorld;
  /** Defaults to the shared office client. */
  target?: PresenceTarget;
}) {
  const memory = useMemo(createPresenceMemory, []);
  const last = useRef<RoomPick | null>(null);
  const since = useRef(Number.POSITIVE_INFINITY);
  // After a reconnect the client re-joins what it last wanted; re-send the pick anyway.
  useEffect(
    () =>
      useConnectionStore.subscribe((s, prev) => {
        if (s.status === "connected" && prev.status !== "connected") last.current = null;
      }),
    [],
  );
  // The building hears which level we are on, at once and after every switch (#268).
  useEffect(() => {
    const tell = (levelId: string) => (target ?? getOfficeClient()).setLevel?.(levelId);
    tell(useLevelStore.getState().levelId);
    return useLevelStore.subscribe((s, prev) => {
      if (s.levelId === prev.levelId) return;
      last.current = null;
      tell(s.levelId);
    });
  }, [target]);
  useFrame((_, dt) => {
    since.current += dt;
    if (since.current < PRESENCE_S) return;
    since.current = 0;
    const player = usePlayerStore.getState();
    if (!player.spawned) return;
    const pick = pickRooms(
      world,
      player,
      useVisibleStore.getState().rooms,
      memory,
      performance.now(),
    );
    if (samePick(last.current, pick)) return;
    last.current = pick;
    void (target ?? getOfficeClient()).setRooms(pick.current, pick.nearby);
  });
  return null;
}
