/**
 * Rooms under construction (#187, SPEC §9.1): on top of the build site's
 * scaffolding, crates, sparks and dust (interiors.ts, CompoundStructure),
 * a crew of henchmen hammering away and a progress plate over the door
 * counting down to `buildEndsAt`. At most two visible sites get a crew.
 * With reduced motion the hammers hold still.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, type Group, LinearFilter, SRGBColorSpace } from "three";
import { selectReducedMotion, useUiStore } from "../../../state/ui.ts";
import { buildProgress, formatRemaining } from "../../../ui/build-mode/progress.ts";
import { providerLightColor } from "../../avatar/colorSets.ts";
import { HenchmanAvatar } from "../../henchmen/HenchmanAvatar.tsx";
import { WALL_THICKNESS } from "../../lair/dimensions.ts";
import { LAIR } from "../../lair/palette.ts";
import { type CompoundWorld, doorCentre, type WorldRoom } from "../world.ts";

/** At most this many sites get a crew and a plate (two draws per henchman). */
export const MAX_CREWED_SITES = 2;

export interface CrewSpot {
  key: string;
  /** Room frame, metres. */
  x: number;
  z: number;
  heading: number;
  trim: string;
  /** Seconds offset of the hammer swing. */
  phase: number;
}

/** Where the crew stands in a site of `w × d` metres: at the scaffolding on the open walls, and by the crates. */
export function crewSpots(w: number, d: number): CrewSpot[] {
  const claude = providerLightColor("claude-code") ?? LAIR.orange;
  const codex = providerLightColor("codex") ?? LAIR.teal;
  return [
    { key: "south", x: w * 0.55, z: d - 1.3, heading: 0, trim: claude, phase: 0 },
    { key: "east", x: w - 1.3, z: d * 0.4, heading: Math.PI / 2, trim: codex, phase: 0.27 },
    { key: "crates", x: w * 0.38, z: d * 0.5, heading: -2.4, trim: claude, phase: 0.51 },
  ].filter((s) => s.x > 0.8 && s.z > 0.8);
}

/** Hammer angle (radians about the arm's axis) at `t` seconds: a quick strike, a slow lift. */
export function hammerAngle(t: number): number {
  const period = 0.7;
  const f = (((t % period) + period) % period) / period;
  const up = -1.1;
  const down = 0.35;
  return f < 0.25 ? up + (down - up) * (f / 0.25) ** 2 : down + (up - down) * ((f - 0.25) / 0.75);
}

function Hammer({ phase, still }: { phase: number; still: boolean }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.x = still ? -0.5 : hammerAngle(clock.elapsedTime + phase);
  });
  return (
    <group ref={ref} position={[0.26, 1.05, 0.3]} name="hammer">
      <mesh position={[0, 0, 0.26]} rotation-x={Math.PI / 2} raycast={() => null}>
        <cylinderGeometry args={[0.035, 0.035, 0.52, 6]} />
        <meshLambertMaterial color={LAIR.walnut} />
      </mesh>
      <mesh position={[0, 0.04, 0.54]} raycast={() => null}>
        <boxGeometry args={[0.12, 0.13, 0.26]} />
        <meshLambertMaterial color={LAIR.steelLight} />
      </mesh>
    </group>
  );
}

const PLATE_PX = { w: 384, h: 128 } as const;

function paintPlate(ctx: CanvasRenderingContext2D, name: string, left: string, fraction: number) {
  const { w, h } = PLATE_PX;
  ctx.fillStyle = "#1E2124";
  ctx.fillRect(0, 0, w, h);
  // Hazard stripes along the top and the bottom.
  for (let x = -h; x < w; x += 24) {
    ctx.fillStyle = LAIR.yellow;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 12, 0);
    ctx.lineTo(x + 22, 10);
    ctx.lineTo(x + 10, 10);
    ctx.fill();
  }
  ctx.strokeStyle = LAIR.brass;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = LAIR.yellow;
  ctx.font = "bold 26px 'Courier New', monospace";
  const title = name.length > 16 ? `${name.slice(0, 15)}…` : name;
  ctx.fillText(`BUILDING ${title.toUpperCase()}`, w / 2, 36);
  ctx.font = "bold 34px 'Courier New', monospace";
  ctx.fillStyle = "#F2E6C8";
  ctx.fillText(left, w / 2, 72);
  ctx.fillStyle = "#0E0F10";
  ctx.fillRect(24, 98, w - 48, 16);
  ctx.fillStyle = LAIR.yellow;
  ctx.fillRect(24, 98, (w - 48) * fraction, 16);
}

const OUT: Readonly<Record<WorldRoom["doorSide"], { x: number; z: number; yaw: number }>> = {
  north: { x: 0, z: -1, yaw: Math.PI },
  south: { x: 0, z: 1, yaw: 0 },
  east: { x: 1, z: 0, yaw: Math.PI / 2 },
  west: { x: -1, z: 0, yaw: -Math.PI / 2 },
};

/** The plate over a site's door: name, time left and a bar, repainted once a second. */
function ProgressPlate({ room, tileMetres }: { room: WorldRoom; tileMetres: number }) {
  const canvas = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = PLATE_PX.w;
    c.height = PLATE_PX.h;
    return c;
  }, []);
  const texture = useMemo(() => {
    if (!canvas) return null;
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.minFilter = LinearFilter;
    t.generateMipmaps = false;
    return t;
  }, [canvas]);
  useEffect(() => {
    const ctx = canvas?.getContext("2d");
    if (!ctx || !texture) return;
    const paint = () => {
      const p = buildProgress(room.id, room.buildEndsAt, Date.now());
      paintPlate(
        ctx,
        room.name,
        p.remainingMs > 0 ? formatRemaining(p.remainingMs) : "ALMOST DONE",
        p.fraction,
      );
      texture.needsUpdate = true;
    };
    paint();
    const h = setInterval(paint, 1000);
    return () => clearInterval(h);
  }, [canvas, texture, room.id, room.name, room.buildEndsAt]);
  useEffect(() => () => texture?.dispose(), [texture]);
  const c = doorCentre(room, tileMetres);
  const o = OUT[room.doorSide];
  const off = WALL_THICKNESS + 0.08;
  return (
    <group position={[c.x + o.x * off, 3.35, c.z + o.z * off]} rotation-y={o.yaw}>
      {/* Tipped back a little toward the overhead camera. */}
      <mesh name={`build-plate-${room.id}`} rotation-x={-0.35} raycast={() => null}>
        <planeGeometry args={[3.3, 1.1]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Site({
  room,
  tileMetres,
  still,
}: {
  room: WorldRoom;
  tileMetres: number;
  still: boolean;
}) {
  const spots = useMemo(() => crewSpots(room.size.w, room.size.d), [room.size.w, room.size.d]);
  return (
    <group name={`build-site-${room.id}`}>
      <group position={[room.origin.x, 0, room.origin.z]}>
        {spots.map((s) => (
          <group key={s.key} position={[s.x, 0, s.z]} rotation-y={s.heading}>
            <HenchmanAvatar animation="point" status="working" trim={s.trim} />
            <Hammer phase={s.phase} still={still} />
          </group>
        ))}
      </group>
      <ProgressPlate room={room} tileMetres={tileMetres} />
    </group>
  );
}

export function BuildSites({
  world,
  visible,
}: {
  world: CompoundWorld;
  visible: ReadonlySet<string>;
}) {
  const still = useUiStore(selectReducedMotion);
  const sites = world.rooms
    .filter((r) => r.kind === "project" && r.buildState === "building" && visible.has(r.id))
    .slice(0, MAX_CREWED_SITES);
  return (
    <group name="build-sites">
      {sites.map((r) => (
        <Site key={r.id} room={r} tileMetres={world.tileMetres} still={still} />
      ))}
    </group>
  );
}
