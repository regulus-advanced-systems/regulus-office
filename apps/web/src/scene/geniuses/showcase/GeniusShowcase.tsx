/**
 * Dev-only genius showcase (apps/web/dev/geniuses.html), for screenshots and
 * the performance probe. Query: `mode=lineup|variants|crowd`, `archetype=`,
 * `anim=`, `n=` (crowd size), `yaw=` (degrees, turns every genius),
 * `iso=1` (the office's 3/4 camera instead of a close front view),
 * `henchman=1` (two henchmen at the ends of the lineup, for scale).
 * Not part of the production build.
 */
import { Canvas } from "@react-three/fiber";
import {
  AVATAR_ANIMATIONS,
  type AvatarAnimation,
  type GeniusArchetype,
  isGeniusArchetype,
  isOneOf,
} from "@regulus/protocol";
import { FpsProbe } from "../../avatar/showcase/FpsProbe.tsx";
import { HenchmanAvatar } from "../../henchmen/HenchmanAvatar.tsx";
import { GeniusAvatar } from "../GeniusAvatar.tsx";
import { crowd, lineup, type ShowcaseGenius, variants } from "./roster.ts";

const isAnimation = isOneOf(AVATAR_ANIMATIONS);

export interface GeniusShowcaseOptions {
  mode: "lineup" | "variants" | "crowd";
  archetype: GeniusArchetype;
  animation: AvatarAnimation;
  count: number;
  yaw: number;
  iso: boolean;
  henchman: boolean;
}

export function geniusShowcaseOptions(search: string): GeniusShowcaseOptions {
  const q = new URLSearchParams(search);
  const mode = q.get("mode");
  const archetype = q.get("archetype");
  const anim = q.get("anim");
  return {
    mode: mode === "variants" || mode === "crowd" ? mode : "lineup",
    archetype: isGeniusArchetype(archetype) ? archetype : "scientist",
    animation: isAnimation(anim) ? anim : "idle",
    count: Number(q.get("n")) || 20,
    yaw: Number(q.get("yaw")) || 0,
    iso: q.get("iso") === "1",
    henchman: q.get("henchman") === "1",
  };
}

function roster(o: GeniusShowcaseOptions): ShowcaseGenius[] {
  if (o.mode === "variants") return variants(o.archetype, o.animation);
  if (o.mode === "crowd") return crowd(o.count);
  return lineup(o.animation);
}

export function GeniusShowcase({ options }: { options: GeniusShowcaseOptions }) {
  const geniuses = roster(options);
  const far = options.mode === "crowd" || options.iso;
  const camera = far
    ? { position: [11, 12, 11] as [number, number, number], fov: 40 }
    : options.mode === "variants"
      ? { position: [0, 2.0, 9.4] as [number, number, number], fov: 38 }
      : { position: [0, 2.1, 7.8] as [number, number, number], fov: 38 };
  return (
    <Canvas
      shadows
      dpr={1}
      camera={{ ...camera, near: 0.1, far: 200 }}
      onCreated={({ camera: c }) => c.lookAt(0, far ? 0 : 1.05, 0)}
      style={{ position: "absolute", inset: 0, background: "#3B3833" }}
    >
      <hemisphereLight args={["#FFE9C7", "#4A4038", 1.1]} />
      <directionalLight
        position={[4, 9, 6]}
        intensity={2.2}
        color="#FFD9A0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <directionalLight position={[-6, 4, -4]} intensity={0.5} color="#9FC3D9" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshToonMaterial color="#8C8478" />
      </mesh>
      {geniuses.map((g) => (
        <GeniusAvatar
          key={g.key}
          look={g.look}
          animation={g.animation}
          position={g.position}
          rotation-y={Math.PI + (options.yaw * Math.PI) / 180}
          name={g.name}
        />
      ))}
      {options.henchman &&
        [-5.2, 5.2].map((x) => (
          <HenchmanAvatar
            key={x}
            position={[x, 0, 0]}
            rotation-y={Math.PI + (options.yaw * Math.PI) / 180}
            animation="idle"
            status="idle"
          />
        ))}
      <FpsProbe probe={false} />
    </Canvas>
  );
}
