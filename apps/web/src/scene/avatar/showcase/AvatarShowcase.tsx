/**
 * Dev-only showcase (apps/web/dev/avatars.html): N robots with mixed
 * animations, colour sets, accessories, statuses, chest lights and name
 * plates on a plain ground, under the SPEC §9.2 orthographic camera, with an
 * fps counter for the SPEC §11 budget (20 robots at 60 fps, 1x pixel ratio).
 * Not imported by the app; it is not part of the production build.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import { colors } from "../../../ui/theme.ts";
import { RobotAvatar } from "../RobotAvatar.tsx";
import { FpsProbe } from "./FpsProbe.tsx";
import { showcaseRobots } from "./roster.ts";

/** Same direction as scene/OfficeCanvas.tsx: yaw 45°, pitch 35.264° (SPEC §9.2). */
const ISO_DISTANCE = 20;
const ISO_POSITION: [number, number, number] = [
  ISO_DISTANCE * Math.SQRT1_2,
  ISO_DISTANCE * Math.tan((35.264 * Math.PI) / 180) * Math.SQRT2 * Math.SQRT1_2,
  ISO_DISTANCE * Math.SQRT1_2,
];

export type ShowcaseOptions = { count: number; zoom: number; shadows: boolean; probe: boolean };

export function showcaseOptionsFrom(search: string): ShowcaseOptions {
  const params = new URLSearchParams(search);
  const num = (key: string, fallback: number) => {
    const value = Number(params.get(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    count: num("n", 20),
    zoom: num("zoom", 40),
    shadows: params.get("shadows") !== "0",
    probe: params.get("probe") === "1",
  };
}

export function AvatarShowcase({ options }: { options: ShowcaseOptions }) {
  const robots = showcaseRobots(options.count);
  return (
    <Canvas
      orthographic
      shadows={options.shadows}
      dpr={1}
      camera={{ position: ISO_POSITION, zoom: options.zoom, near: 0.1, far: 200 }}
      style={{ position: "absolute", inset: 0, background: colors.cream }}
    >
      <hemisphereLight args={["#ffffff", colors.cream, 0.9]} />
      <directionalLight
        position={[-8, 12, 6]}
        intensity={1.4}
        castShadow={options.shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshToonMaterial color="#D8C79A" />
      </mesh>
      <Suspense fallback={null}>
        {robots.map((robot) => (
          <RobotAvatar key={robot.key} {...robot.props} />
        ))}
      </Suspense>
      <FpsProbe probe={options.probe} />
      <OrbitControls enableRotate={false} makeDefault />
    </Canvas>
  );
}
