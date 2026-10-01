/**
 * The office scene since the compound (SPEC §9, §11, §12; #186): the whole
 * island-mountain lair from the published layout (lobby, corridors, every
 * room with its generated interior, doors, the special rooms, build sites),
 * under a rotatable 3/4 perspective camera that follows the player, with
 * the cutaway fading walls between the camera and the player. The player
 * walks the compound nav grid; the client joins the FloorRooms of the room
 * it is in and up to three nearby visible rooms, whose robots, boards and
 * screens are drawn live (RoomLayers). The compound sits in its mountain,
 * and the lobby's blast door opens onto the beach, the dock and the sea
 * (outside/, #188); the nav grid follows the door. Pixel ratio 1, render
 * loop paused while the tab is hidden; `V` still swaps in the first-person rig.
 * Build mode (#187, build/) adds the ghost, construction crews and the room
 * transitions, and frames the compound while a room is being placed.
 */
import { Canvas } from "@react-three/fiber";
import type { Pose } from "@regulus/floor-layout";
import { type ReactNode, Suspense, useEffect, useLayoutEffect, useMemo } from "react";
import { useCompoundStore } from "../../state/compound.ts";
import { useFloorStore } from "../../state/floor.ts";
import { usePlayerStore } from "../../state/player.ts";
import { occupancyKey, parseOccupancy, useRoomsStore } from "../../state/rooms.ts";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { useViewStore } from "../../state/view.ts";
import { useBuildModeStore } from "../../ui/build-mode/store.ts";
import { useViewHotkey } from "../../ui/hud/ViewToggle.tsx";
import { CarriedCards } from "../boards/CarriedCards.tsx";
import { CompoundCamera } from "../camera/CompoundCamera.tsx";
import { ViewCrossfade } from "../camera/ViewCrossfade.tsx";
import { FirstPersonRig } from "../fpv/FirstPersonRig.tsx";
import { createPlayerBinding } from "../fpv/playerBinding.ts";
import { useDocumentHidden } from "../hooks/useDocumentHidden.ts";
import { CutawayDriver, LairKit } from "../lair/components/LairKit.tsx";
import { LampLights } from "../lair/components/LampLights.tsx";
import { MovementController } from "../movement/MovementController.tsx";
import { StatsOverlay } from "../perf/StatsOverlay.tsx";
import { statsEnabled } from "../perf/stats.ts";
import { UsageScreen } from "../usage/UsageScreen.tsx";
import { BuildLayer } from "./build/BuildLayer.tsx";
import { useRoomDraftStore, withDraft } from "./build/preview.ts";
import { useRoomTransitions } from "./build/RoomTransitions.tsx";
import { CompoundStructure } from "./CompoundStructure.tsx";
import { corridorChunks } from "./corridors.ts";
import { CompoundDoors } from "./Doors.tsx";
import { Culling, type PresenceTarget, RoomPresence } from "./Drivers.tsx";
import { compoundNavGrid, lobbySpawn, navKey, outsideRows } from "./navigation.ts";
import { createNavProbe } from "./navProbe.ts";
import { useDoorPassable } from "./outside/doorState.ts";
import { useDoorwayGuard } from "./outside/guard.ts";
import { outsideLayout } from "./outside/layout.ts";
import { Mountain } from "./outside/Mountain.tsx";
import { Outside } from "./outside/Outside.tsx";
import { createOutsideProbe } from "./outside/probe.ts";
import { placeRoom } from "./placed.ts";
import { detectTier, effectiveQuality, presetOf, useQualityStore } from "./quality.ts";
import { RoomLayers } from "./RoomLayers.tsx";
import { useVisibleStore } from "./visibility.ts";
import { builtBounds, type CompoundWorld, lobbyOf, worldExtent } from "./world.ts";

const BACKGROUND = "#141312";
/** Past the mountain's shoulders: the far sea (outside/water.ts SEA.far), so the island sits in it (#190). */
const SEA_BACKGROUND = "#163A6A";
/** The blast door is not a sliding room door: outside/BlastDoor.tsx draws it. */
const NO_EXTRA_DOORS: never[] = [];

const playerBinding = createPlayerBinding(usePlayerStore);
/** Shift belongs to build mode while placing (Shift+R turns the door back): no running then (#223). */
const canRun = () => useBuildModeStore.getState().intent === null;

export interface CompoundCanvasProps {
  world: CompoundWorld;
  /** Humans, mounted in `<group name="avatars">`. */
  avatars?: ReactNode;
  /** Where room joins go (the dev harness passes a stand-in); defaults to the office client. */
  presence?: PresenceTarget;
  /** Moves go here; defaults to the office client. */
  send?: (pose: Pose) => void;
  children?: ReactNode;
}

function Scene({ world, avatars, presence, send, children }: CompoundCanvasProps) {
  useViewHotkey();
  const mode = useViewStore((s) => s.mode);
  const cameraMode = useViewStore((s) => s.cameraMode);
  const firstPerson = cameraMode === "first_person";
  const rigMounted = firstPerson || mode === "first_person";
  const spawned = usePlayerStore((s) => s.spawned);
  const preset = presetOf(useQualityStore((s) => s.quality));

  const extent = worldExtent(world);
  // The overview frames the built rooms and corridors, not the whole empty grid.
  const built = useMemo(() => builtBounds(world), [world]);
  // Room settings' live preview (#187) draws the room as edited; changes animate (build/).
  const draft = useRoomDraftStore((s) => s.draft);
  const reduced = useUiStore(selectReducedMotion);
  const placed = useMemo(() => withDraft(world.rooms, draft).map(placeRoom), [world, draft]);
  const { rooms, playing } = useRoomTransitions(placed, reduced);
  // While placing a room the camera frames the compound with room to build around it.
  const frame = useBuildModeStore((s) => s.frame);
  const chunks = useMemo(
    () =>
      corridorChunks({
        width: world.width,
        depth: world.depth,
        corridors: world.corridors,
        rooms: world.rooms.map((r) => r.rect),
      }),
    [world],
  );
  const key = navKey(world);
  // The blast door is shared state (#188): the doorway onto the beach is walkable while it is open.
  const doorOpen = useDoorPassable();
  const grid = useMemo(() => compoundNavGrid(world, { blastDoorOpen: doorOpen }), [key, doorOpen]);
  useDoorwayGuard(grid);
  const spawn = useMemo(() => lobbySpawn(world), [world]);
  // The clickable ground runs past the beach strip to the end of the dock.
  const groundD = (world.depth + outsideRows(world)) * world.tileMetres;
  const plane = useMemo(() => ({ x: 0, z: 0, w: extent.w, d: groundD }), [extent.w, groundD]);
  const lobby = lobbyOf(world);
  const outside = useMemo(
    () => outsideLayout(world),
    [world.width, world.depth, world.outsideDepth, world.tileMetres, world.blastDoor],
  );
  const lobbyUsage = useMemo(() => {
    const art = rooms.find((r) => r.room.kind === "lobby")?.art.dressing?.usage;
    return art && lobby
      ? {
          ...art,
          position: [
            art.position[0] + lobby.origin.x,
            art.position[1],
            art.position[2] + lobby.origin.z,
          ] as const,
        }
      : null;
  }, [rooms, lobby]);

  const visibleRooms = useVisibleStore((s) => s.rooms);
  const visibleChunks = useVisibleStore((s) => s.chunks);
  // Joined rooms and their robots' desks ("room=seat,seat|..."): changes when a robot sits or leaves.
  const occupancy = useRoomsStore((s) => occupancyKey(s.states));
  const joined = useMemo(() => parseOccupancy(occupancy), [occupancy]);
  const lamps = useMemo(
    () => [
      ...rooms.filter((r) => visibleRooms.has(r.room.id)).flatMap((r) => r.lamps),
      ...chunks.filter((c) => visibleChunks.has(c.key)).flatMap((c) => c.lamps),
    ],
    [rooms, chunks, visibleRooms, visibleChunks],
  );
  const focus = useMemo(() => {
    const at = { x: 0, y: 1, z: 0 };
    return () => {
      const p = usePlayerStore.getState();
      at.x = p.x;
      at.z = p.z;
      return at;
    };
  }, []);

  return (
    <>
      <color attach="background" args={[preset.mountain ? SEA_BACKGROUND : BACKGROUND]} />
      <CompoundCamera
        centre={frame?.centre ?? built.centre}
        extent={frame?.extent ?? built.extent}
        enabled={!firstPerson}
      />
      {rigMounted && (
        <FirstPersonRig
          grid={grid}
          spawn={spawn}
          spawnKey="compound"
          active={firstPerson}
          getPose={spawned ? playerBinding.getPose : undefined}
          onMove={spawned ? playerBinding.onMove : undefined}
          canRun={canRun}
        />
      )}
      <hemisphereLight args={["#B4C2D4", "#5A4A3A", 1.7]} />
      <directionalLight
        position={[built.centre.x - 40, 60, built.centre.z + 30]}
        intensity={1.4}
        color="#FFE6C4"
      />
      <LairKit>
        {preset.mountain && <Mountain world={world} layout={outside} />}
        {outside && <Outside layout={outside} />}
        <CutawayDriver focus={focus} enabled={!firstPerson} />
        {preset.lampLights > 0 && (
          <LampLights
            key={preset.lampLights}
            lamps={lamps}
            focus={focus}
            count={preset.lampLights}
            intensity={4}
            distance={8}
          />
        )}
        <CompoundStructure
          world={world}
          rooms={rooms}
          chunks={chunks}
          visibleRooms={visibleRooms}
          visibleChunks={visibleChunks}
          joined={joined}
        />
        <CompoundDoors rooms={rooms} extra={NO_EXTRA_DOORS} />
        <BuildLayer world={world} visible={visibleRooms} playing={playing} />
      </LairKit>
      <Culling rooms={rooms} chunks={chunks} />
      <MovementController
        grid={grid}
        spawn={spawn}
        spawnKey="compound"
        plane={plane}
        send={send}
        canRun={canRun}
      />
      <RoomPresence world={world} target={presence} />
      <Suspense fallback={null}>
        <RoomLayers rooms={rooms} />
        {lobbyUsage && lobby && visibleRooms.has(lobby.id) && (
          <group
            position={lobbyUsage.position}
            rotation-y={lobbyUsage.rotationY}
            name="lobby-usage-wall"
          >
            <UsageScreen w={lobbyUsage.w} h={lobbyUsage.h} />
          </group>
        )}
        <CarriedCards />
      </Suspense>
      <group name="avatars">{avatars}</group>
      {children}
    </>
  );
}

export function CompoundCanvas(props: CompoundCanvasProps) {
  const hidden = useDocumentHidden();
  const showStats = useMemo(() => statsEnabled(window.location.search), []);
  // The detail preset (quality.ts): detected from the GPU once, changeable in Settings.
  const detected = useMemo(() => {
    const tier = detectTier();
    useQualityStore.getState().setDetected(tier);
    return tier;
  }, []);
  const setting = useUiStore((s) => s.settings.graphics);
  const quality = effectiveQuality(detected, setting, window.location.search);
  // The first render already draws at the right tier; later Settings changes follow.
  useMemo(() => useQualityStore.getState().set(quality), []);
  useLayoutEffect(() => useQualityStore.getState().set(quality), [quality]);
  const preset = presetOf(quality);
  useEffect(() => {
    if (!showStats) return;
    const world = () => useCompoundStore.getState().world ?? props.world;
    window.__regulusNav = createNavProbe(world);
    window.__regulusOutside = createOutsideProbe(() => outsideLayout(world()));
    return () => {
      window.__regulusNav = undefined;
      window.__regulusOutside = undefined;
    };
  }, [showStats, props.world]);
  return (
    <div style={{ position: "absolute", inset: 0, isolation: "isolate", background: BACKGROUND }}>
      <Canvas
        // MSAA is fixed when the context is made: a change of it makes a new canvas.
        key={preset.antialias ? "msaa" : "plain"}
        flat
        dpr={preset.resolutionScale}
        frameloop={hidden ? "never" : "always"}
        gl={{ antialias: preset.antialias, powerPreference: "high-performance" }}
        camera={{ fov: 40, near: 0.3, far: 600, position: [0, 30, 30] }}
        style={{ position: "absolute", inset: 0 }}
        onCreated={(state) => {
          if (!showStats) return;
          window.__regulusR3F = state;
          window.__regulusFloorStore = useFloorStore;
        }}
      >
        <Scene {...props} />
        {showStats && <StatsOverlay />}
      </Canvas>
      <ViewCrossfade />
    </div>
  );
}
