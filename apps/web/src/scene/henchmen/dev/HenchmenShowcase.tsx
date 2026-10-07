/**
 * Dev-only showcase (apps/web/dev/henchmen.html, #184): the henchmen on a
 * plain floor under a toon light rig, for screenshots and the §11 frame-rate
 * budget. Query: view=skins|trims|heads|lights|secretary|poses|crowd (default
 * skins), n=<crowd size>, zoom=<ortho zoom>, cam=front|iso, anim=<animation for
 * every henchman>, status=<agent status>, seated=1, hand=1, shadows=0,
 * skin=<form for the poses view>. Not part of the build.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import {
  AGENT_STATUSES,
  type AgentStatus,
  AVATAR_ANIMATIONS,
  type AvatarAnimation,
  CHARACTER_FORM_IDS,
  isAgentStatus,
  isOneOf,
  PROVIDER_IDS,
} from "@regulus/protocol";
import { colors } from "../../../ui/theme.ts";
import { providerLightColor } from "../../avatar/colorSets.ts";
import { FpsProbe } from "../../avatar/showcase/FpsProbe.tsx";
import { HenchmanAvatar, type HenchmanAvatarProps } from "../HenchmanAvatar.tsx";
import { HENCHMAN_GESTURES, type HenchmanGesture } from "../henchmanAnimation.ts";

const isAnimation = isOneOf(AVATAR_ANIMATIONS);
const isGesture = isOneOf(HENCHMAN_GESTURES);
type View = "skins" | "trims" | "heads" | "lights" | "secretary" | "poses" | "crowd";

/** Ids that between them show every hair style, several skin tones and hair colours. */
const CREW = [
  "rivet",
  "relay",
  "quartz",
  "valve",
  "bolt",
  "chisel",
  "flint",
  "anvil",
  "turbine",
  "shim",
  "ember",
  "rotor",
];

interface Entry {
  key: string;
  x: number;
  z: number;
  props: HenchmanAvatarProps;
}

/** Animation, seated, gesture, status (for the light). */
const POSES: ReadonlyArray<[AvatarAnimation, boolean, HenchmanGesture, AgentStatus?]> = [
  ["idle", false, "none"],
  ["walk", false, "none"],
  ["read", false, "none"],
  ["think", false, "none"],
  ["celebrate", false, "none"],
  ["facepalm", false, "none"],
  ["wave", false, "none"],
  ["point", false, "none"],
  ["sit_type", true, "none"],
  // Done: one hand held up. Waiting: both arms waving, or held with reduced motion (#235).
  ["sit_idle", true, "hand", "done"],
  ["sit_idle", true, "needs_you", "waiting_permission"],
  ["sit_idle", true, "needs_you_still", "waiting_input"],
];

function entries(view: View, params: URLSearchParams): Entry[] {
  const anim = params.get("anim");
  const animation = isAnimation(anim) ? anim : undefined;
  const status = params.get("status");
  const gesture = params.get("gesture");
  const base: HenchmanAvatarProps = {
    animation: animation ?? "idle",
    status: isAgentStatus(status) ? (status as AgentStatus) : "working",
    seated: params.get("seated") === "1",
    gesture: isGesture(gesture) ? gesture : params.get("hand") === "1" ? "hand" : "none",
  };
  const row = (n: number, i: number, gap = 1.1) => (i - (n - 1) / 2) * gap;
  if (view === "trims")
    return PROVIDER_IDS.map((p, i) => ({
      key: p,
      x: row(PROVIDER_IDS.length, i),
      z: 0,
      props: { ...base, trim: providerLightColor(p), seed: CREW[i] },
    }));
  if (view === "heads")
    return CREW.map((seed, i) => ({
      key: seed,
      x: row(5, i % 5, 1.0),
      z: Math.floor(i / 5) * 1.6 - 0.8,
      props: { ...base, seed, trim: providerLightColor(PROVIDER_IDS[i % 2] ?? "codex") },
    }));
  if (view === "lights") {
    const seated = [true, false];
    return seated.flatMap((sit, r) =>
      AGENT_STATUSES.map((s, i) => ({
        key: `${s}-${r}`,
        x: row(AGENT_STATUSES.length, i, 0.95),
        z: r * 1.7 - 0.85,
        props: {
          ...base,
          animation: sit ? ("sit_idle" as const) : ("idle" as const),
          seated: sit,
          status: s,
          seed: CREW[i],
          trim: providerLightColor("claude-code"),
        },
      })),
    );
  }
  if (view === "secretary") {
    const shows: Array<[AvatarAnimation, boolean, string, string]> = [
      ["idle", false, "moneypenny", "claude-code"],
      ["walk", false, "ada", "codex"],
      ["think", false, "vesper", "claude-code"],
      ["wave", false, "tilly", "codex"],
      ["sit_type", true, "greta", "claude-code"],
    ];
    return shows.map(([a, seated, seed, provider], i) => ({
      key: seed,
      x: row(shows.length, i),
      z: 0,
      props: {
        ...base,
        skin: "secretary",
        animation: a,
        seated,
        seed,
        trim: providerLightColor(provider as (typeof PROVIDER_IDS)[number]),
      },
    }));
  }
  if (view === "poses")
    return POSES.map(([a, seated, gesture, status], i) => ({
      key: `${a}-${gesture}`,
      x: row(5, i % 5, 1.3),
      z: Math.floor(i / 5) * 2.4 - 1.2,
      props: {
        ...base,
        animation: a,
        seated,
        gesture,
        status: status ?? base.status,
        skin: params.get("skin") ?? undefined,
        seed: CREW[i % CREW.length],
        trim: providerLightColor("claude-code"),
      },
    }));
  if (view === "crowd") {
    const n = Number(params.get("n") ?? 20);
    return Array.from({ length: n }, (_, i) => {
      const [a, seated, gesture] = POSES[i % POSES.length] ?? ["idle", false, "none"];
      return {
        key: String(i),
        x: row(5, i % 5, 1.3),
        z: Math.floor(i / 5) * 1.3 - 2,
        props: {
          animation: animation ?? a,
          seated,
          gesture,
          status: "working",
          skin: CHARACTER_FORM_IDS[i % CHARACTER_FORM_IDS.length],
          seed: `crowd-${i}`,
          trim: providerLightColor(PROVIDER_IDS[i % 2] ?? "codex"),
        },
      };
    });
  }
  return CHARACTER_FORM_IDS.map((skin, i) => ({
    key: skin,
    x: row(CHARACTER_FORM_IDS.length, i),
    z: 0,
    props: { ...base, skin, seed: CREW[i], trim: providerLightColor("claude-code") },
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
      <OrbitControls target={[0, 0.85, 0]} makeDefault />
    </Canvas>
  );
}
