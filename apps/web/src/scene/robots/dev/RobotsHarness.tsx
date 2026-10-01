/**
 * Dev-only office harness (apps/web/dev/robots.html): the compound scene
 * (#186) of a 64-tile office with a row of rooms, the player standing in the
 * big "Dev" room with N fake henchmen at its desks, bubbles flying to the HUD
 * counters and an fps probe (`window.__avatarStats`). No server: the rooms'
 * FloorRoom states are faked in the stores.
 * Query: n=<robots> (default 12), mode=working|mixed|waiting|idle|flap, rate=<ticks/s>,
 * reduced=1, seats=all, skins=mixed, providers=all, zoom=<0..1 camera zoom>,
 * yaw=<degrees>, nearby=<0..3 nearby rooms with robots too>, locked=<room ids the viewer may
 * not enter>, building=<room ids still being built>. Not part of the production build.
 */
import type { FloorState, RobotState } from "@regulus/protocol";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useCameraStore } from "../../../state/camera.ts";
import { useFloorStore } from "../../../state/floor.ts";
import { usePlayerStore } from "../../../state/player.ts";
import { useRoomsStore } from "../../../state/rooms.ts";
import { useUiStore } from "../../../state/ui.ts";
import { WorkCounters } from "../../../ui/hud/WorkCounters.tsx";
import { FpsProbe } from "../../avatar/showcase/FpsProbe.tsx";
import { AvatarLayer } from "../../avatars/AvatarLayer.tsx";
import { CompoundCanvas } from "../../compound/CompoundCanvas.tsx";
import { roomLayout } from "../../compound/interiors.ts";
import { type TestRoom, testWorld } from "../../compound/testing.ts";
import { roomById } from "../../compound/world.ts";
import { useGongStore } from "../../gong/gongStore.ts";
import { playGong } from "../../gong/gongSynth.ts";
import { fakeRobots, harnessMode } from "./fakeRobots.ts";
import "../../../ui/globals.css";
import "../../../ui/hud.css";

const noSend = () => {};
const noPresence = { setRooms: async () => {} };
const DEV = "dev";

/** A 64-tile compound: the 12 × 12 Dev room with every desk, and three ordinary rooms. */
function harnessWorld(locked: readonly string[], building: readonly string[]) {
  const rooms: TestRoom[] = [
    {
      id: DEV,
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
  return testWorld(
    rooms.map((r) => ({ ...r, building: building.includes(r.id) })),
    rooms.map((r) => r.id).filter((id) => !locked.includes(id)),
    64,
  );
}

function floorState(
  floorId: string,
  robots: Record<string, RobotState>,
  deskCount: number,
): FloorState {
  return {
    floorId,
    name: floorId,
    slug: floorId,
    paletteId: "teal-cream",
    layoutTemplateId: "room",
    repos: [],
    robots,
    desks: {},
    decor: {},
    queue: [],
    issues: {},
    pulls: {},
    services: {},
    whiteboardVersion: 0,
    carriedCards: {},
    queueSettings: { maxRunning: 2, maxPerOwner: 2 },
    deskCount,
    decorStyle: "ops_room",
  };
}

function ring(strikes: number) {
  const cause = strikes > 1 ? "queue_empty" : "merge";
  useGongStore.getState().heard({ floorId: DEV, cause, strikes });
  const ui = useUiStore.getState();
  playGong(strikes, {
    volume: ui.settings.volume,
    reducedMotion: ui.settings.reducedMotion === true,
  });
}

export function RobotsHarness({ search }: { search: string }) {
  const params = new URLSearchParams(search);
  const n = Number(params.get("n") ?? 12);
  const mode = harnessMode(params.get("mode"));
  const rate = Number(params.get("rate") ?? 2);
  const allSeats = params.get("seats") === "all";
  const skins = params.get("skins") === "mixed" ? "mixed" : "standard";
  const providers = params.get("providers") === "all" ? "all" : "two";
  const nearby = Math.min(3, Number(params.get("nearby") ?? 0));
  const locked = params.get("locked") ?? "";
  const building = params.get("building") ?? "";
  const world = useMemo(
    () => harnessWorld(locked.split(","), building.split(",")),
    [locked, building],
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const q = new URLSearchParams(search);
    if (q.get("reduced") === "1") useUiStore.getState().updateSettings({ reducedMotion: true });
    const zoom = q.get("zoom");
    if (zoom !== null) useCameraStore.getState().setZoom(Number(zoom));
    const yaw = q.get("yaw");
    if (yaw !== null) useCameraStore.setState({ yaw: (Number(yaw) * Math.PI) / 180 });
    // Stand in the Dev room, by its door, before the scene spawns us in the lobby.
    const dev = roomById(world, DEV);
    const layout = dev ? roomLayout(dev) : null;
    if (dev && layout)
      usePlayerStore.getState().spawnAt(
        {
          x: dev.origin.x + layout.spawn.x,
          z: dev.origin.z + layout.spawn.z - 1.5,
          heading: 0,
        },
        "compound",
      );
    const timer = setInterval(() => setTick((t) => t + 1), 1000 / Math.max(0.1, rate));
    return () => clearInterval(timer);
  }, [rate, search, world]);

  useEffect(() => {
    const rooms = useRoomsStore.getState();
    const ids = [DEV, "apollo", "hermes", "zeus"].slice(0, 1 + nearby);
    for (const id of ids) {
      const room = roomById(world, id);
      const layout = room ? roomLayout(room) : null;
      if (!room || !layout) continue;
      const count = id === DEV ? n : 4;
      const robots = fakeRobots(layout, count, tick, mode, allSeats, { skins, providers });
      const state = floorState(id, robots, room.deskCount);
      rooms.apply(id, state);
      // The HUD counters and the interactive room read the floor store.
      if (id === DEV) useFloorStore.setState({ floorId: DEV, state });
    }
  }, [tick, n, mode, allSeats, skins, providers, nearby, world]);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <CompoundCanvas world={world} avatars={<AvatarLayer />} presence={noPresence} send={noSend}>
        <Suspense fallback={null}>
          <FpsProbe probe={false} />
        </Suspense>
      </CompoundCanvas>
      <div className="rg-hud">
        <WorkCounters />
        <div style={{ position: "fixed", right: 16, bottom: 16, display: "flex", gap: 8 }}>
          <button type="button" onClick={() => ring(1)}>
            Ring the gong
          </button>
          <button type="button" onClick={() => ring(3)}>
            Queue done (x3)
          </button>
        </div>
      </div>
    </div>
  );
}
