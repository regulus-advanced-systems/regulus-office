/**
 * Build mode in the scene (#187, SPEC §9.1): the ghost room snapped to the
 * grid (green when the spot is clear, red when it is not, the rooms it hits
 * outlined), its door and the block outside it, the corridor it would add,
 * and a tile grid around it. The cursor drives it: the ghost follows the
 * floor point under the mouse, a left click holds it there (and does not
 * walk the player). Nothing here takes pointer hits.
 */
import { useThree } from "@react-three/fiber";
import type { DoorSide, TileRect } from "@regulus/protocol";
import { doorFront, doorStart } from "@regulus/room-layout";
import { useEffect, useMemo } from "react";
import { BoxGeometry, EdgesGeometry, GridHelper, Raycaster, Vector2 } from "three";
import { useCompoundStore } from "../../../state/compound.ts";
import { ghostAt } from "../../../ui/build-mode/logic.ts";
import { useBuildModeStore } from "../../../ui/build-mode/store.ts";
import { useVerdict } from "../../../ui/build-mode/verdict.ts";
import { WALL_HEIGHT } from "../../lair/dimensions.ts";
import { LAIR } from "../../lair/palette.ts";
import { groundPointFromRay } from "../../movement/cursorFacing.ts";
import type { CompoundWorld } from "../world.ts";

const OK = "#3BD16F";
const BAD = LAIR.red;
const PATH = LAIR.yellow;
const GHOST_WALL = 2.2;
const noHit = () => null;

/** The ghost follows the cursor; a left click on the scene holds it (and never walks). */
export function GhostPointer({ world }: { world: CompoundWorld }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const el = gl.domElement;
    const ray = new Raycaster();
    const ndc = new Vector2();
    const ground = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return groundPointFromRay(ray.ray.origin, ray.ray.direction);
    };
    const onMove = (e: PointerEvent) => {
      const s = useBuildModeStore.getState();
      if (!s.intent || s.busy) return;
      const p = ground(e);
      if (p) s.hover(world, ghostAt(world, p, s.size));
    };
    // Capture on window: runs before the scene's own click handling, which it stops.
    const onClick = (e: MouseEvent) => {
      if (e.target !== el || e.button !== 0) return;
      const s = useBuildModeStore.getState();
      if (!s.intent) return;
      e.stopPropagation();
      e.preventDefault();
      if (s.busy) return;
      const p = ground(e);
      if (p) s.pinAt(world, ghostAt(world, p, s.size));
    };
    el.addEventListener("pointermove", onMove);
    window.addEventListener("click", onClick, { capture: true });
    return () => {
      el.removeEventListener("pointermove", onMove);
      window.removeEventListener("click", onClick, { capture: true });
    };
  }, [camera, gl, world]);
  return null;
}

function Slab({
  rect,
  m,
  y,
  color,
  opacity,
}: {
  rect: TileRect;
  m: number;
  y: number;
  color: string;
  opacity: number;
}) {
  return (
    <mesh
      position={[(rect.x + rect.w / 2) * m, y, (rect.y + rect.d / 2) * m]}
      rotation-x={-Math.PI / 2}
      raycast={noHit}
    >
      <planeGeometry args={[rect.w * m, rect.d * m]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

/** Wall segments of the ghost (metres, x/z centre and length), leaving the door open. */
export function ghostWalls(
  rect: TileRect,
  side: DoorSide,
  m: number,
): { x: number; z: number; len: number; alongX: boolean }[] {
  const x0 = rect.x * m;
  const z0 = rect.y * m;
  const x1 = (rect.x + rect.w) * m;
  const z1 = (rect.y + rect.d) * m;
  const door = doorStart(rect, side);
  const walls: { side: DoorSide; a: number; b: number; fixed: number; alongX: boolean }[] = [
    { side: "north", a: x0, b: x1, fixed: z0, alongX: true },
    { side: "south", a: x0, b: x1, fixed: z1, alongX: true },
    { side: "west", a: z0, b: z1, fixed: x0, alongX: false },
    { side: "east", a: z0, b: z1, fixed: x1, alongX: false },
  ];
  const out: { x: number; z: number; len: number; alongX: boolean }[] = [];
  const push = (w: (typeof walls)[number], a: number, b: number) => {
    if (b - a < 0.01) return;
    const mid = (a + b) / 2;
    out.push(
      w.alongX
        ? { x: mid, z: w.fixed, len: b - a, alongX: true }
        : { x: w.fixed, z: mid, len: b - a, alongX: false },
    );
  };
  for (const w of walls) {
    if (w.side !== side) {
      push(w, w.a, w.b);
      continue;
    }
    const start = (w.alongX ? door.x : door.y) * m;
    push(w, w.a, start);
    push(w, start + 2 * m, w.b);
  }
  return out;
}

/** A hazard-yellow threshold across the doorway and an arrow pointing out of it. */
function DoorMarker({ rect, side, m }: { rect: TileRect; side: DoorSide; m: number }) {
  const door = doorStart(rect, side);
  const alongX = side === "north" || side === "south";
  const cx = (door.x + (alongX ? 1 : 0)) * m;
  const cz = (door.y + (alongX ? 0 : 1)) * m;
  const out = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[side];
  const yaw = Math.atan2(out[0] ?? 0, out[1] ?? 0);
  return (
    <group position={[cx, 0, cz]} rotation-y={yaw} raycast={noHit}>
      <mesh position={[0, 0.12, 0]} raycast={noHit}>
        <boxGeometry args={[2 * m, 0.24, 0.3]} />
        <meshBasicMaterial color={PATH} />
      </mesh>
      <mesh position={[0, 0.2, 1.3]} rotation-x={Math.PI / 2} raycast={noHit}>
        <coneGeometry args={[0.6, 1.2, 3]} />
        <meshBasicMaterial color={PATH} />
      </mesh>
    </group>
  );
}

const outline = new EdgesGeometry(new BoxGeometry(1, 1, 1));

function Outline({ rect, m, color }: { rect: TileRect; m: number; color: string }) {
  return (
    <lineSegments
      geometry={outline}
      position={[(rect.x + rect.w / 2) * m, WALL_HEIGHT / 2, (rect.y + rect.d / 2) * m]}
      scale={[rect.w * m + 0.4, WALL_HEIGHT + 0.2, rect.d * m + 0.4]}
      raycast={noHit}
    >
      <lineBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
    </lineSegments>
  );
}

export function Ghost({ world }: { world: CompoundWorld }) {
  const intent = useBuildModeStore((s) => s.intent);
  const ghost = useBuildModeStore((s) => s.ghost);
  const size = useBuildModeStore((s) => s.size);
  const side = useBuildModeStore((s) => s.doorSide);
  const verdict = useVerdict();
  const world2 = useCompoundStore((s) => s.world) ?? world;
  const m = world.tileMetres;
  const rect = useMemo(
    () => ({ x: ghost.x, y: ghost.y, w: size.w, d: size.d }),
    [ghost.x, ghost.y, size.w, size.d],
  );
  const walls = useMemo(() => ghostWalls(rect, side, m), [rect, side, m]);
  const front = useMemo(() => doorFront(rect, side), [rect, side]);
  const grid = useMemo(() => {
    const n = 2 * Math.ceil((Math.max(size.w, size.d) + 12) / 2);
    const g = new GridHelper(n * m, n, OK, "#8FA39A");
    const mat = g.material as { transparent: boolean; opacity: number; depthWrite: boolean };
    mat.transparent = true;
    mat.opacity = 0.28;
    mat.depthWrite = false;
    return g;
  }, [size.w, size.d, m]);
  useEffect(() => () => grid.dispose(), [grid]);
  if (!intent) return null;
  const bad = verdict?.state === "refused";
  const color = bad ? BAD : OK;
  const moving =
    intent.kind === "move" ? world2.rooms.find((r) => r.id === intent.operationId) : null;
  const conflicts = (verdict?.conflicts ?? [])
    .map((id) => world2.rooms.find((r) => r.id === id || r.kind === id))
    .filter((r) => r !== undefined);
  // Grid lines on tile edges: centred on a tile corner near the ghost's middle.
  const gx = (rect.x + Math.floor(rect.w / 2)) * m;
  const gz = (rect.y + Math.floor(rect.d / 2)) * m;
  return (
    <group name="build-ghost" userData={{ rect, side, ok: !bad }}>
      <primitive object={grid} position={[gx, 0.04, gz]} raycast={noHit} />
      <Slab rect={rect} m={m} y={0.08} color={color} opacity={0.3} />
      {walls.map((w) => (
        <mesh
          key={`${w.x},${w.z},${w.alongX}`}
          position={[w.x, GHOST_WALL / 2, w.z]}
          raycast={noHit}
        >
          <boxGeometry args={w.alongX ? [w.len, GHOST_WALL, 0.25] : [0.25, GHOST_WALL, w.len]} />
          <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} />
        </mesh>
      ))}
      <Outline rect={rect} m={m} color={color} />
      <Slab rect={front} m={m} y={0.1} color={PATH} opacity={bad ? 0.25 : 0.6} />
      <DoorMarker rect={rect} side={side} m={m} />
      {!bad &&
        verdict?.corridor.map((r) => (
          <Slab
            key={`${r.x},${r.y},${r.w},${r.d}`}
            rect={r}
            m={m}
            y={0.07}
            color={PATH}
            opacity={0.38}
          />
        ))}
      {conflicts.map((r) => (
        <Outline key={r.id} rect={r.rect} m={m} color={BAD} />
      ))}
      {moving && <Outline rect={moving.rect} m={m} color="#E8E2D0" />}
    </group>
  );
}
