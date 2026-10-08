/**
 * Dev-only office harness (apps/web/dev/office.html): the compound scene
 * (#186) of a 64-tile office with a row of rooms, the player standing in the
 * big "Dev" room with N fake henchmen at its desks, bubbles flying to the HUD
 * counters and an fps probe (`window.__avatarStats`). No server: the rooms'
 * OperationRoom states are faked in the stores.
 * Query: n=<henchmen> (default 12), mode=working|mixed|waiting|idle|flap|day|hands, rate=<ticks/s>,
 * near=1 (seat them at the desks nearest the player), reduced=1, activity=0 (hide activity bubbles), seats=all, skins=mixed, providers=all, zoom=<0..1 camera zoom>,
 * yaw=<degrees>, nearby=<0..3 nearby rooms with henchmen too>, locked=<room ids the viewer may
 * not enter>, building=<room ids still being built>, rooms=<project rooms, 4..12>,
 * humans=<humans on screen, the local player included>, agents=<office agents walking the Dev
 * room, #252>.
 * Levels (#269): level=lobby|regulus|ante|holding (default regulus, where the Dev room is; the
 * lobby level with `at=` or `door=`), at=lift (stand at the level's lift), at=door:<room id>, closed=<room ids sent
 * as closed, or "none"; default vault,crypt on the "ante" level>, holding=1 (publish the holding
 * level), lift=open (the lift's panel open), travel=open (quick travel open). `E` at the lift
 * opens its panel; the levels can be ridden. Not part of the production build.
 */
import {
  type BuildingState,
  type HenchmanState,
  HOLDING_LEVEL_ID,
  LOBBY_LEVEL_ID,
  type OperationInfo,
  type OperationState,
} from "@regulus/protocol";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useBuildingStore } from "../../../state/building.ts";
import { useCameraStore } from "../../../state/camera.ts";
import { useCompoundStore, useCompoundWorldSync } from "../../../state/compound.ts";
import { useLevelStore } from "../../../state/level.ts";
import { LIFT_OVERLAY } from "../../../state/lift.ts";
import { useAgentAttention } from "../../../state/officeAgents.ts";
import { useOperationStore } from "../../../state/operation.ts";
import { useOperationsStore } from "../../../state/operations.ts";
import { usePlayerStore } from "../../../state/player.ts";
import { useRoomsStore } from "../../../state/rooms.ts";
import { useSessionStore } from "../../../state/session.ts";
import { useUiStore } from "../../../state/ui.ts";
import { useGlobalHotkeys } from "../../../ui/hotkeys/useHotkeys.ts";
import {
  QUICK_TRAVEL_OVERLAY,
  QuickTravelDialog,
  useQuickTravelHotkey,
} from "../../../ui/hud/QuickTravel.tsx";
import { WorkCounters } from "../../../ui/hud/WorkCounters.tsx";
import { LiftPanel } from "../../../ui/lift/LiftPanel.tsx";
import { LiftRide } from "../../../ui/lift/LiftRide.tsx";
import { themeCssText } from "../../../ui/theme.ts";
import { Toaster } from "../../../ui/toast/Toaster.tsx";
import { FpsProbe } from "../../avatar/showcase/FpsProbe.tsx";
import { AvatarLayer } from "../../avatars/AvatarLayer.tsx";
import { CompoundCanvas } from "../../compound/CompoundCanvas.tsx";
import { roomLayout } from "../../compound/interiors.ts";
import { liftOf } from "../../compound/lift/spot.ts";
import { useDoorOverride } from "../../compound/outside/doorState.ts";
import { dockPoint, type OutsideLayout, outsideLayout } from "../../compound/outside/layout.ts";
import { type CompoundWorld, roomById, travelPose } from "../../compound/world.ts";
import { useGongStore } from "../../gong/gongStore.ts";
import { playGong } from "../../gong/gongSynth.ts";
import { fakeBodies } from "../../officeAgents/dev/fakeBodies.ts";
import { fakeHenchmen, harnessMode } from "./fakeHenchmen.ts";
import {
  ANTE_LEVEL,
  DEFAULT_CLOSED,
  DEV_ROOM as DEV,
  fakeHumans,
  harnessLair,
  REGULUS_LEVEL,
} from "./harnessWorld.ts";
import "../../../ui/globals.css";
import "../../../ui/hud.css";

const noSend = () => {};
/** The design tokens the dialogs (the lift's panel, quick travel) are drawn with, as in App.tsx. */
const THEME_CSS = themeCssText();
const noPresence = { setRooms: async () => {} };

const LEVEL_PARAM: Readonly<Record<string, string>> = {
  lobby: LOBBY_LEVEL_ID,
  regulus: REGULUS_LEVEL,
  ante: ANTE_LEVEL,
  holding: HOLDING_LEVEL_ID,
};

const ids = (list: string) => list.split(",").filter(Boolean);

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
  const near = params.get("near") === "1";
  const skins = params.get("skins") === "mixed" ? "mixed" : "standard";
  const providers = params.get("providers") === "all" ? "all" : "two";
  const nearby = Math.min(3, Number(params.get("nearby") ?? 0));
  const locked = params.get("locked") ?? "";
  const building = params.get("building") ?? "";
  const roomCount = Math.min(12, Number(params.get("rooms") ?? 4));
  const humanCount = Math.max(1, Number(params.get("humans") ?? 1));
  const agentCount = Math.max(0, Number(params.get("agents") ?? 0));
  const closedParam = params.get("closed");
  const closed = closedParam === null ? DEFAULT_CLOSED.join(",") : closedParam;
  const holding = params.get("holding") === "1";
  const lair = useMemo(
    () =>
      harnessLair({
        rooms: roomCount,
        locked: ids(locked),
        building: ids(building),
        closed: closed === "none" ? [] : ids(closed),
        holding,
      }),
    [locked, building, roomCount, closed, holding],
  );
  // The same path as the office page: the stores hold the lair, the world is the viewed level.
  useMemo(() => {
    const q = new URLSearchParams(search);
    const asked = LEVEL_PARAM[q.get("level") ?? ""];
    const outside = q.get("at") === "beach" || q.get("at") === "dock" || q.get("at") === "lobby";
    useLevelStore
      .getState()
      .set(asked ?? (outside || q.get("door") ? LOBBY_LEVEL_ID : REGULUS_LEVEL));
  }, [search]);
  useMemo(() => {
    useBuildingStore.setState({
      state: { ...lair.state, humans: {} },
      sessionId: "me",
    });
    useOperationsStore.setState({
      operations: lair.enterable.map((operationId) => ({
        operationId,
        repos: [],
      })) as unknown as OperationInfo[],
    });
  }, [lair]);
  useCompoundWorldSync();
  const world = useCompoundStore((s) => s.world);
  if (!world) return null;
  return (
    <HarnessScene
      world={world}
      lair={lair}
      params={{
        n,
        mode,
        rate,
        allSeats,
        near,
        skins,
        providers,
        nearby,
        humanCount,
        agentCount,
        search,
      }}
    />
  );
}

interface SceneParams {
  n: number;
  mode: ReturnType<typeof harnessMode>;
  rate: number;
  allSeats: boolean;
  near: boolean;
  skins: "mixed" | "standard";
  providers: "all" | "two";
  nearby: number;
  humanCount: number;
  agentCount: number;
  search: string;
}

function HarnessScene({
  world,
  lair,
  params,
}: {
  world: CompoundWorld;
  lair: ReturnType<typeof harnessLair>;
  params: SceneParams;
}) {
  const {
    n,
    mode,
    rate,
    allSeats,
    near,
    skins,
    providers,
    nearby,
    humanCount,
    agentCount,
    search,
  } = params;
  useGlobalHotkeys();
  useQuickTravelHotkey();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const q = new URLSearchParams(search);
    if (q.get("reduced") === "1") useUiStore.getState().updateSettings({ reducedMotion: true });
    // activity=0: the "Activity bubbles" setting off; "needs you" and "answer ready" stay (#256).
    useUiStore.getState().updateSettings({ activityBubbles: q.get("activity") !== "0" });
    const zoom = q.get("zoom");
    if (zoom !== null) useCameraStore.getState().setZoom(Number(zoom));
    const yaw = q.get("yaw");
    if (yaw !== null) useCameraStore.setState({ yaw: (Number(yaw) * Math.PI) / 180 });
    // The blast door and the outside (#188): `door=open|closing|closed|alarm`, `at=lobby|beach|dock`.
    // `doorAfter=<ms>` applies it later, to catch the leaves moving.
    const door = q.get("door");
    const applyDoor = () => {
      if (door === "open" || door === "closing" || door === "closed")
        useDoorOverride.getState().set({ phase: door });
      if (door === "alarm") useDoorOverride.getState().set({ phase: "closed", alarm: true });
    };
    const doorTimer = setTimeout(applyDoor, Number(q.get("doorAfter") ?? 0));
    if (q.get("lift") === "open") useUiStore.getState().openOverlay(LIFT_OVERLAY);
    if (q.get("travel") === "open") useUiStore.getState().openOverlay(QUICK_TRAVEL_OVERLAY);
    const timer = setInterval(() => setTick((t) => t + 1), 1000 / Math.max(0.1, rate));
    return () => {
      clearInterval(timer);
      clearTimeout(doorTimer);
    };
  }, [rate, search]);

  // Where the player starts, once: `at=`, else by the Dev room's door, else at the level's lift.
  // Later level changes (the lift, quick travel) place the player themselves.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current) return;
    placed.current = true;
    const at = new URLSearchParams(search).get("at");
    const outside = outsideLayout(world);
    const dev = roomById(world, DEV);
    const layout = dev ? roomLayout(dev) : null;
    const doorOf = at?.startsWith("door:") ? roomById(world, at.slice(5)) : undefined;
    const spot =
      (doorOf ? travelPose(doorOf) : null) ??
      (outside ? harnessSpot(outside, at) : null) ??
      (at !== "lift" && dev && layout
        ? { x: dev.origin.x + layout.spawn.x, z: dev.origin.z + layout.spawn.z - 1.5, heading: 0 }
        : (liftOf(world)?.stand ?? null));
    if (spot) usePlayerStore.getState().spawnAt(spot, "compound");
  }, [world, search]);

  useEffect(() => {
    const rooms = useRoomsStore.getState();
    const ids = [DEV, "apollo", "hermes", "zeus"].slice(0, 1 + nearby);
    for (const id of ids) {
      const room = roomById(world, id);
      const layout = room ? roomLayout(room) : null;
      if (!room || !layout) continue;
      const count = id === DEV ? n : 4;
      const henchmen = fakeHenchmen(
        layout,
        count,
        tick,
        mode,
        allSeats,
        { skins, providers },
        id === DEV && near ? { x: layout.spawn.x, z: layout.spawn.z - 1.5 } : undefined,
      );
      const state = operationState(id, henchmen, room.deskCount);
      rooms.apply(id, state);
      // The HUD counters and the interactive room read the operation store.
      if (id === DEV) useOperationStore.setState({ operationId: DEV, state });
    }
    // Other humans (#190 perf gate: 4 humans on screen), walking round the Dev room.
    const dev = roomById(world, DEV);
    if ((humanCount > 1 || agentCount > 0) && dev) {
      const seconds = tick / Math.max(0.1, rate);
      const centre = { x: dev.origin.x + dev.size.w / 2, z: dev.origin.z + dev.size.d / 2 };
      const humans = fakeHumans(humanCount, centre, seconds);
      // Office agents (#252) walking the Dev room; the first is the viewer's own, with an answer ready.
      const officeAgents = Object.fromEntries(
        Object.entries(
          fakeBodies(
            agentCount,
            { x: dev.origin.x, z: dev.origin.z, w: dev.size.w, d: dev.size.d },
            seconds,
          ),
        ).map(([id, body]) => [id, { ...body, levelId: REGULUS_LEVEL, operationId: DEV }]),
      );
      useBuildingStore.setState({
        state: { ...lair.state, humans, officeAgents },
        sessionId: "me",
      });
      if (agentCount > 0) {
        useSessionStore.setState({
          user: { id: "me", displayName: "You", role: "owner" } as never,
        });
        useAgentAttention
          .getState()
          .set([{ agentId: "office-agent-1", unread: true, waiting: false }]);
      }
    }
  }, [
    tick,
    n,
    mode,
    allSeats,
    skins,
    providers,
    nearby,
    world,
    humanCount,
    agentCount,
    lair,
    rate,
    near,
  ]);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <style id="rg-theme">{THEME_CSS}</style>
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
        <QuickTravelDialog />
        <LiftPanel />
        <LiftRide />
        <Toaster />
      </div>
    </div>
  );
}
