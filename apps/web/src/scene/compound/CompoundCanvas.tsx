/**
 * The office scene since the compound (SPEC §9, §11, §12; #186): the whole
 * island-mountain lair from the published layout (lobby, corridors, every
 * room with its generated interior, doors, the special rooms, build sites),
 * under a rotatable 3/4 perspective camera that follows the player, with
 * the cutaway fading walls between the camera and the player. The player
 * walks the compound nav grid; the client joins the FloorRooms of the room
 * it is in and up to three nearby visible rooms, whose robots, boards and
 * screens are drawn live (RoomLayers). Pixel ratio 1, render loop paused
 * while the tab is hidden; `V` still swaps in the first-person rig.
 */
import { Canvas } from "@react-three/fiber";
import type { Pose } from "@regulus/floor-layout";
import { type ReactNode, Suspense, useEffect, useMemo } from "react";
import { useCompoundStore } from "../../state/compound.ts";
import { useFloorStore } from "../../state/floor.ts";
import { usePlayerStore } from "../../state/player.ts";
import { occupancyKey, parseOccupancy, useRoomsStore } from "../../state/rooms.ts";
import { useViewStore } from "../../state/view.ts";
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
import { CompoundStructure } from "./CompoundStructure.tsx";
import { corridorChunks } from "./corridors.ts";
import { CompoundDoors } from "./Doors.tsx";
import { Culling, type PresenceTarget, RoomPresence } from "./Drivers.tsx";
import { compoundNavGrid, lobbySpawn, navKey } from "./navigation.ts";
import { createNavProbe } from "./navProbe.ts";
import { blastDoors, placeRoom } from "./placed.ts";
import { detectQuality, useQualityStore } from "./quality.ts";
import { RoomLayers } from "./RoomLayers.tsx";
import { useVisibleStore } from "./visibility.ts";
import { builtBounds, type CompoundWorld, lobbyOf, worldExtent } from "./world.ts";

const BACKGROUND = "#141312";
const BEDROCK = "#221E1A";

const playerBinding = createPlayerBinding(usePlayerStore);

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
  const quality = useQualityStore((s) => s.quality);

  const extent = worldExtent(world);
  // The overview frames the built rooms and corridors, not the whole empty grid.
  const built = useMemo(() => builtBounds(world), [world]);
  const rooms = useMemo(() => world.rooms.map(placeRoom), [world]);
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
  const grid = useMemo(() => compoundNavGrid(world), [key]);
  const spawn = useMemo(() => lobbySpawn(world), [world]);
  const plane = useMemo(() => ({ x: 0, z: 0, w: extent.w, d: extent.d }), [extent.w, extent.d]);
  const lobby = lobbyOf(world);
  const blast = useMemo(
    () => (lobby ? blastDoors(lobby, world.tileMetres, world.blastDoor) : []),
    [lobby, world.tileMetres, world.blastDoor],
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
      <color attach="background" args={[BACKGROUND]} />
      <CompoundCamera centre={built.centre} extent={built.extent} enabled={!firstPerson} />
      {rigMounted && (
        <FirstPersonRig
          grid={grid}
          spawn={spawn}
          spawnKey="compound"
          active={firstPerson}
          getPose={spawned ? playerBinding.getPose : undefined}
          onMove={spawned ? playerBinding.onMove : undefined}
        />
      )}
      <hemisphereLight args={["#B4C2D4", "#5A4A3A", 1.7]} />
      <directionalLight
        position={[built.centre.x - 40, 60, built.centre.z + 30]}
        intensity={1.4}
        color="#FFE6C4"
      />
      {quality === "high" && (
        <mesh
          rotation-x={-Math.PI / 2}
          position={[extent.w / 2, -0.03, extent.d / 2]}
          raycast={() => null}
        >
          <planeGeometry args={[extent.w + 40, extent.d + 40]} />
          <meshBasicMaterial color={BEDROCK} />
        </mesh>
      )}
      <LairKit>
        <CutawayDriver focus={focus} enabled={!firstPerson} />
        {quality === "high" && (
          <LampLights lamps={lamps} focus={focus} count={6} intensity={4} distance={8} />
        )}
        <CompoundStructure
          world={world}
          rooms={rooms}
          chunks={chunks}
          visibleRooms={visibleRooms}
          visibleChunks={visibleChunks}
          joined={joined}
        />
        <CompoundDoors rooms={rooms} extra={blast} />
      </LairKit>
      <Culling rooms={rooms} chunks={chunks} />
      <MovementController grid={grid} spawn={spawn} spawnKey="compound" plane={plane} send={send} />
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
  // Software WebGL (quality.ts): no MSAA, which multiplies its per-pixel work.
  const quality = useMemo(() => {
    const q = detectQuality(window.location.search);
    useQualityStore.getState().set(q);
    return q;
  }, []);
  useEffect(() => {
    if (!showStats) return;
    window.__regulusNav = createNavProbe(() => useCompoundStore.getState().world ?? props.world);
    return () => {
      window.__regulusNav = undefined;
    };
  }, [showStats, props.world]);
  return (
    <div style={{ position: "absolute", inset: 0, isolation: "isolate", background: BACKGROUND }}>
      <Canvas
        flat
        dpr={1}
        frameloop={hidden ? "never" : "always"}
        gl={{ antialias: quality === "high", powerPreference: "high-performance" }}
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
