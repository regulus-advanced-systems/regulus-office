/**
 * Dev-only office harness (apps/web/dev/office.html): the compound scene
 * (#186) of a 64-tile office with a row of rooms, the player standing in the
 * big "Dev" room with N fake henchmen at its desks, bubbles flying to the HUD
 * counters and an fps probe (`window.__avatarStats`). No server: the rooms'
 * OperationRoom states are faked in the stores.
 * Query: n=<henchmen> (default 12), mode=working|mixed|waiting|idle|flap, rate=<ticks/s>,
 * reduced=1, seats=all, skins=mixed, providers=all, zoom=<0..1 camera zoom>,
 * yaw=<degrees>, nearby=<0..3 nearby rooms with henchmen too>, locked=<room ids the viewer may
 * not enter>, building=<room ids still being built>, rooms=<project rooms, 4..12>,
 * humans=<humans on screen, the local player included>. Not part of the production build.
 */
import type { HenchmanState, OperationState } from "@regulus/protocol";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useBuildingStore } from "../../../state/building.ts";
import { useCameraStore } from "../../../state/camera.ts";
import { useOperationStore } from "../../../state/operation.ts";
import { usePlayerStore } from "../../../state/player.ts";
import { useRoomsStore } from "../../../state/rooms.ts";
import { useUiStore } from "../../../state/ui.ts";
import { WorkCounters } from "../../../ui/hud/WorkCounters.tsx";
import { FpsProbe } from "../../avatar/showcase/FpsProbe.tsx";
import { AvatarLayer } from "../../avatars/AvatarLayer.tsx";
import { CompoundCanvas } from "../../compound/CompoundCanvas.tsx";
import { roomLayout } from "../../compound/interiors.ts";
import { useDoorOverride } from "../../compound/outside/doorState.ts";
import { dockPoint, type OutsideLayout, outsideLayout } from "../../compound/outside/layout.ts";
import { roomById } from "../../compound/world.ts";
import { useGongStore } from "../../gong/gongStore.ts";
import { playGong } from "../../gong/gongSynth.ts";
import { fakeHenchmen, harnessMode } from "./fakeHenchmen.ts";
import { DEV_ROOM as DEV, fakeHumans, harnessBuilding, harnessWorld } from "./harnessWorld.ts";
import "../../../ui/globals.css";
import "../../../ui/hud.css";

const noSend = () => {};
const noPresence = { setRooms: async () => {} };

function operationState(
  operationId: string,
  henchmen: Record<string, HenchmanState>,
  deskCount: number,
): OperationState {
  return {
    operationId,
    name: operationId,
    slug: operationId,
    paletteId: "teal-cream",
    layoutTemplateId: "room",
    repos: [],
    henchmen,
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
  useGongStore.getState().heard({ operationId: DEV, cause, strikes });
  const ui = useUiStore.getState();
  playGong(strikes, {
    volume: ui.settings.volume,
    reducedMotion: ui.settings.reducedMotion === true,
  });
}

/** Where `at=` puts the player: in the lobby facing the blast door, on the beach, on the dock. */
function harnessSpot(layout: OutsideLayout, at: string | null) {
  const c = layout.door.centre;
  if (at === "lobby") return { x: c, z: layout.edgeZ - 4, heading: Math.PI };
  if (at === "beach") return { x: c - 2, z: layout.edgeZ + 5, heading: 0 };
  if (at === "dock") return { ...dockPoint(layout, 0.8), heading: 0 };
  return null;
}

export function HenchmenHarness({ search }: { search: string }) {
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
  const roomCount = Math.min(12, Number(params.get("rooms") ?? 4));
  const humanCount = Math.max(1, Number(params.get("humans") ?? 1));
  const world = useMemo(
    () => harnessWorld(locked.split(","), building.split(","), roomCount),
    [locked, building, roomCount],
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
    // The blast door and the outside (#188): `door=open|closing|closed|alarm`, `at=lobby|beach|dock`.
    // `doorAfter=<ms>` applies it later, to catch the leaves moving.
    const door = q.get("door");
    const applyDoor = () => {
      if (door === "open" || door === "closing" || door === "closed")
        useDoorOverride.getState().set({ phase: door });
      if (door === "alarm") useDoorOverride.getState().set({ phase: "closed", alarm: true });
    };
    const doorTimer = setTimeout(applyDoor, Number(q.get("doorAfter") ?? 0));
    const outside = outsideLayout(world);
    const spot = outside ? harnessSpot(outside, q.get("at")) : null;
    if (spot) usePlayerStore.getState().spawnAt(spot, "compound");
    const timer = setInterval(() => setTick((t) => t + 1), 1000 / Math.max(0.1, rate));
    return () => {
      clearInterval(timer);
      clearTimeout(doorTimer);
    };
  }, [rate, search, world]);

  useEffect(() => {
    const rooms = useRoomsStore.getState();
    const ids = [DEV, "apollo", "hermes", "zeus"].slice(0, 1 + nearby);
    for (const id of ids) {
      const room = roomById(world, id);
      const layout = room ? roomLayout(room) : null;
      if (!room || !layout) continue;
      const count = id === DEV ? n : 4;
      const henchmen = fakeHenchmen(layout, count, tick, mode, allSeats, { skins, providers });
      const state = operationState(id, henchmen, room.deskCount);
      rooms.apply(id, state);
      // The HUD counters and the interactive room read the operation store.
      if (id === DEV) useOperationStore.setState({ operationId: DEV, state });
    }
    // Other humans (#190 perf gate: 4 humans on screen), walking round the Dev room.
    const dev = roomById(world, DEV);
    if (humanCount > 1 && dev) {
      const centre = { x: dev.origin.x + dev.size.w / 2, z: dev.origin.z + dev.size.d / 2 };
      const humans = fakeHumans(humanCount, centre, tick / Math.max(0.1, rate));
      useBuildingStore.setState({ state: harnessBuilding(roomCount, humans), sessionId: "me" });
    }
  }, [tick, n, mode, allSeats, skins, providers, nearby, world, humanCount, roomCount, rate]);

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
