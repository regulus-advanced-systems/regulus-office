/**
 * Dev-only showcase (apps/web/dev/henchmen.html, #184): the henchmen on a
 * plain floor under a toon light rig, for screenshots and the §11 frame-rate
 * budget. Query: view=skins|trims|poses|crowd (default skins), n=<crowd size>,
 * zoom=<ortho zoom>, cam=front|iso, anim=<animation for every henchman>,
 * status=<agent status>, seated=1, hand=1, shadows=0. Not part of the build.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import {
  type AgentStatus,
  AVATAR_ANIMATIONS,
  type AvatarAnimation,
  HENCHMAN_SKIN_IDS,
  isAgentStatus,
  isOneOf,
  PROVIDER_IDS,
} from "@regulus/protocol";
import { colors } from "../../../ui/theme.ts";
import { providerLightColor } from "../../avatar/colorSets.ts";
import { FpsProbe } from "../../avatar/showcase/FpsProbe.tsx";
import { HenchmanAvatar, type HenchmanAvatarProps } from "../HenchmanAvatar.tsx";

const isAnimation = isOneOf(AVATAR_ANIMATIONS);
type View = "skins" | "trims" | "poses" | "crowd";

interface Entry {
  key: string;
  x: number;
  z: number;
  props: HenchmanAvatarProps;
}

const POSES: ReadonlyArray<[AvatarAnimation, boolean, boolean]> = [
  ["idle", false, false],
  ["walk", false, false],
  ["read", false, false],
  ["think", false, false],
  ["celebrate", false, false],
  ["facepalm", false, false],
  ["wave", false, false],
  ["point", false, false],
  ["sit_type", true, false],
  ["sit_idle", true, true],
];

function entries(view: View, params: URLSearchParams): Entry[] {
  const anim = params.get("anim");
  const animation = isAnimation(anim) ? anim : undefined;
  const status = params.get("status");
  const base: HenchmanAvatarProps = {
    animation: animation ?? "idle",
    status: isAgentStatus(status) ? (status as AgentStatus) : "working",
    seated: params.get("seated") === "1",
    handRaised: params.get("hand") === "1",
  };
  const row = (n: number, i: number, gap = 1.1) => (i - (n - 1) / 2) * gap;
  if (view === "trims")
    return PROVIDER_IDS.map((p, i) => ({
      key: p,
      x: row(PROVIDER_IDS.length, i),
      z: 0,
      props: { ...base, trim: providerLightColor(p) },
    }));
  if (view === "poses")
    return POSES.map(([a, seated, hand], i) => ({
      key: a,
      x: row(5, i % 5, 1.3),
      z: Math.floor(i / 5) * 2.4 - 1.2,
      props: {
        ...base,
        animation: a,
        seated,
        handRaised: hand,
        status: hand ? "waiting_permission" : base.status,
        trim: providerLightColor("claude-code"),
      },
    }));
  if (view === "crowd") {
    const n = Number(params.get("n") ?? 20);
    return Array.from({ length: n }, (_, i) => {
      const [a, seated, hand] = POSES[i % POSES.length] ?? ["idle", false, false];
      return {
        key: String(i),
        x: row(5, i % 5, 1.3),
        z: Math.floor(i / 5) * 1.3 - 2,
        props: {
          animation: animation ?? a,
          seated,
          handRaised: hand,
          status: "working",
          skin: HENCHMAN_SKIN_IDS[i % HENCHMAN_SKIN_IDS.length],
          trim: providerLightColor(PROVIDER_IDS[i % 2] ?? "codex"),
        },
      };
    });
  }
  return HENCHMAN_SKIN_IDS.map((skin, i) => ({
    key: skin,
    x: row(HENCHMAN_SKIN_IDS.length, i),
    z: 0,
    props: { ...base, skin, trim: providerLightColor("claude-code") },
  }));
}

export function HenchmenShowcase({ search }: { search: string }) {
  const params = new URLSearchParams(search);
  const view = (params.get("view") ?? "skins") as View;
  const zoom = Number(params.get("zoom") ?? 160);
  const shadows = params.get("shadows") !== "0";
  const iso = params.get("cam") === "iso";
  const position: [number, number, number] = iso ? [10, 10, 10] : [2.2, 3.2, 12];
  const list = entries(view, params);
  return (
    <Canvas
      orthographic
      shadows={shadows}
      dpr={1}
      camera={{ position, zoom, near: 0.1, far: 200 }}
      style={{ position: "absolute", inset: 0, background: colors.cream }}
    >
      <hemisphereLight args={["#ffffff", "#8a7a5a", 0.9]} />
      <directionalLight
        position={[4, 9, 7]}
        intensity={1.5}
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshToonMaterial color="#B9AE98" />
      </mesh>
      {list.map((e) => (
        <HenchmanAvatar key={e.key} position={[e.x, 0, e.z]} rotation-y={Math.PI} {...e.props} />
      ))}
      <FpsProbe probe={false} />
      <OrbitControls target={[0, 0.75, 0]} makeDefault />
    </Canvas>
  );
}
