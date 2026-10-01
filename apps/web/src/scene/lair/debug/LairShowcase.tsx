/**
 * Dev-only lair art kit showcase (#183), served by Vite at
 * `/dev/lair.html` and never part of the production build: an ops room
 * made by the room generator (#182) and dressed from its model ids, a
 * gallery of the other decor styles, the corridor junction outside its
 * door, a room under construction (scaffolding, crates, sparks, dust) and
 * a catalogue apron with every piece, under the lair lighting, with an
 * orbit camera. The cutaway follows
 * the orbit target as a stand-in for the player. See views.ts for the
 * query options; `O` toggles the doors and `A` the alarm.
 */
import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Vector3 } from "three";
import { Beacons } from "../components/Beacons.tsx";
import { BlinkingLamps } from "../components/BlinkingLamps.tsx";
import { BlobShadows } from "../components/BlobShadows.tsx";
import { PieceSet } from "../components/InstancedPieces.tsx";
import { CutawayDriver, LairKit } from "../components/LairKit.tsx";
import { LampLights } from "../components/LampLights.tsx";
import { SlidingDoors } from "../components/SlidingDoors.tsx";
import { CORRIDOR_WIDTH, WALL_THICKNESS } from "../dimensions.ts";
import { PIECES } from "../kit.ts";
import { LAIR } from "../palette.ts";
import { Dust, Sparks } from "../particles/BuildParticles.tsx";
import {
  DebugGeniuses,
  DebugHenchmen,
  extraCrew,
  geniusSpots,
  roomCrew,
} from "./DebugHenchmen.tsx";
import { RoomLooks } from "./RoomLooks.tsx";
import { corridorOrigin, mainRoom, mainRoomLayout, styleGallery } from "./sampleRooms.ts";
import { BUILD_SITE, catalogue, sampleBuildSite, sampleCorridors } from "./sampleScene.ts";
import { type ShowcaseOptions, VIEWS } from "./views.ts";

/** Gallery rooms are staffed in a skin that suits their style. */
const STYLE_SKINS: Readonly<Record<string, string>> = {
  lab: "lab_coat",
  workshop: "standard",
  war_room: "black_ops",
};

declare global {
  interface Window {
    /** Frames drawn so far (screenshot scripts wait for a few). */
    __lairFrames?: number;
    /** Draw calls and triangles of the last frame. */
    __lairStats?: { calls: number; triangles: number; fps: number };
  }
}

function Probe({ statsEl }: { statsEl: HTMLElement | null }) {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ frames: 0, since: performance.now() });
  useFrame(() => {
    window.__lairFrames = (window.__lairFrames ?? 0) + 1;
    acc.current.frames++;
    const now = performance.now();
    if (now - acc.current.since < 500) return;
    const fps = (acc.current.frames * 1000) / (now - acc.current.since);
    acc.current = { frames: 0, since: now };
    const { calls, triangles } = gl.info.render;
    window.__lairStats = { calls, triangles, fps };
    if (statsEl)
      statsEl.textContent = `${fps.toFixed(0)} fps · ${calls} draw calls · ${(triangles / 1000).toFixed(1)}k tris`;
  });
  return null;
}

function Scene({
  options,
  doorsOpen,
  alarm,
}: {
  options: ShowcaseOptions;
  doorsOpen: boolean;
  alarm: boolean;
}) {
  const main = useMemo(() => mainRoom(options.style), [options.style]);
  const gallery = useMemo(styleGallery, []);
  const rooms = useMemo(() => [main, ...gallery.map((g) => g.scene)], [main, gallery]);
  const origin = useMemo(() => corridorOrigin(main, CORRIDOR_WIDTH, WALL_THICKNESS), [main]);
  const corridors = useMemo(() => sampleCorridors(origin), [origin]);
  const bosses = useMemo(() => geniusSpots(gallery), [gallery]);
  const crew = useMemo(
    () => [
      ...roomCrew(mainRoomLayout(options.style), "main"),
      ...gallery.flatMap((g) => roomCrew(g.layout, g.style, STYLE_SKINS[g.style], g.offset)),
      ...extraCrew(origin[0] + CORRIDOR_WIDTH / 2, origin[2], BUILD_SITE),
    ],
    [options.style, gallery, origin],
  );
  const site = useMemo(sampleBuildSite, []);
  const cat = useMemo(catalogue, []);
  const view = VIEWS[options.view];
  const target = useMemo(() => new Vector3(...view.target), [view]);
  const pieces = useMemo(
    () => [
      ...rooms.flatMap((r) => r.pieces),
      ...corridors.pieces,
      ...site.pieces,
      ...cat.placements,
    ],
    [rooms, corridors, site, cat],
  );
  const doors = useMemo(
    () => [
      ...rooms.flatMap((r, k) =>
        r.doors.map((d, i) => ({ ...d, id: `room-${k}-${i}`, open: doorsOpen })),
      ),
      ...site.doors.map((d, i) => ({ ...d, id: `site-${i}`, open: !doorsOpen })),
    ],
    [rooms, site, doorsOpen],
  );
  const lamps = useMemo(
    () => [...rooms.flatMap((r) => r.lamps), ...corridors.lamps, ...site.lamps],
    [rooms, corridors, site],
  );
  const consoleLamps = useMemo(() => rooms.flatMap((r) => r.consoleLamps), [rooms]);
  const looks = useMemo(() => rooms.flatMap((r) => r.looks), [rooms]);
  // One accent light per room from the generator's lighting (a fixed count).
  const accents = useMemo(
    () => rooms.flatMap((r) => r.lights.filter((l) => l.kind === "accent")),
    [rooms],
  );
  const beacons = useMemo(
    () => [...rooms.flatMap((r) => r.beacons), ...site.beacons],
    [rooms, site],
  );
  const focusAt = useMemo(() => {
    const f: readonly [number, number, number] = "focus" in view ? view.focus : view.target;
    return new Vector3(...f);
  }, [view]);
  const focus = () => focusAt;
  return (
    <LairKit>
      <color attach="background" args={["#141312"]} />
      <hemisphereLight args={["#B4C2D4", "#5A4A3A", 1.8]} />
      <directionalLight position={[-10, 22, 8]} intensity={1.5} color="#FFE6C4" />
      <LampLights lamps={lamps} focus={focus} count={6} intensity={4} distance={8} />
      {accents.map((l) => (
        <pointLight
          key={`${l.id}@${l.x},${l.z}`}
          position={[l.x, l.y, l.z]}
          color={l.color}
          intensity={l.intensity * 3}
          distance={l.range * 1.5}
          decay={1.4}
        />
      ))}
      <CutawayDriver focus={focus} enabled={options.cutaway} />
      {/* Bedrock under everything, so cut walls show the mountain around the rooms. */}
      <mesh rotation-x={-Math.PI / 2} position={[25, -0.1, 10]}>
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial color="#201D1A" />
      </mesh>
      <PieceSet items={pieces} />
      <BlobShadows items={pieces} />
      <BlinkingLamps lamps={consoleLamps} />
      <RoomLooks looks={looks} />
      {options.henchmen && <DebugHenchmen spots={crew} />}
      {options.henchmen && <DebugGeniuses spots={bosses} />}
      <SlidingDoors doors={doors} />
      <Beacons items={beacons} active={alarm} lights={2} />
      <Sparks origin={[BUILD_SITE.x + 7, 2.5, BUILD_SITE.z + 3]} />
      <Sparks origin={[BUILD_SITE.x + 3, 1.3, BUILD_SITE.z + 6.4]} seed={5} count={60} />
      <Dust
        box={{ center: [BUILD_SITE.x + 4, 1.2, BUILD_SITE.z + 4], size: [8, 2.4, 8] }}
        count={70}
        size={0.45}
      />
      {options.labels &&
        cat.labels.map((l) => (
          <Html key={l.id} position={l.position} center style={{ pointerEvents: "none" }}>
            <div
              style={{
                color: LAIR.cream,
                font: "11px monospace",
                whiteSpace: "nowrap",
                textShadow: "0 0 3px #000",
              }}
            >
              {PIECES[l.id].label}
            </div>
          </Html>
        ))}
      <OrbitControls target={target} makeDefault maxPolarAngle={Math.PI * 0.49} />
    </LairKit>
  );
}

export function LairShowcase({ options }: { options: ShowcaseOptions }) {
  const [doorsOpen, setDoorsOpen] = useState(options.doorOpen);
  const [alarm, setAlarm] = useState(options.alarm);
  const [statsEl, setStatsEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "o" || e.key === "O") setDoorsOpen((v) => !v);
      if (e.key === "a" || e.key === "A") setAlarm((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const view = VIEWS[options.view];
  return (
    <>
      <Canvas
        flat
        dpr={1}
        camera={{ position: [...view.position], fov: 40, near: 0.1, far: 300 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        style={{ position: "absolute", inset: 0 }}
      >
        <Scene options={options} doorsOpen={doorsOpen} alarm={alarm} />
        <Probe statsEl={statsEl} />
      </Canvas>
      <div className="panel" data-testid="lair-panel">
        <strong>Lair art kit (#183)</strong>
        {options.stats && <div ref={setStatsEl}>measuring…</div>}
        <div className="row">
          <button type="button" onClick={() => setDoorsOpen((v) => !v)}>
            {doorsOpen ? "Close doors" : "Open doors"} (O)
          </button>
          <button type="button" onClick={() => setAlarm((v) => !v)}>
            Alarm {alarm ? "off" : "on"} (A)
          </button>
        </div>
      </div>
    </>
  );
}
