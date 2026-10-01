/**
 * What a room shows from the corridor (#186, SPEC §9.1): a plaque over the
 * door with its name and robot counts (every project room, so locked doors
 * still say what is behind them), and a rock cap over rooms this viewer may
 * not enter, so the 3/4 camera never looks into them. One plaque mesh per
 * visible room, one instanced draw for all caps.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { BoxGeometry, type InstancedMesh, Matrix4, MeshLambertMaterial } from "three";
import { WALL_HEIGHT, WALL_THICKNESS } from "../lair/dimensions.ts";
import { LAIR } from "../lair/palette.ts";
import { createSignTexture, SIGN_PX, type SignText } from "./signTexture.ts";
import { type CompoundWorld, doorCentre, type WorldRoom } from "./world.ts";

const SIGN_W = 2.2;
const SIGN_H = (SIGN_W * SIGN_PX.h) / SIGN_PX.w;
/** The plaque hangs beside the door at eye height, on the corridor side of the wall. */
const SIGN_Y = 2.05;
/** From the door's centre along the wall: past the frame (a 2-tile door is 4 m wide). */
const SIGN_ALONG = 3.3;
const OUT = WALL_THICKNESS + 0.03;

const OUTWARD: Readonly<Record<WorldRoom["doorSide"], { x: number; z: number; yaw: number }>> = {
  north: { x: 0, z: -1, yaw: Math.PI },
  south: { x: 0, z: 1, yaw: 0 },
  east: { x: 1, z: 0, yaw: Math.PI / 2 },
  west: { x: -1, z: 0, yaw: -Math.PI / 2 },
};

function Plaque({ room, tileMetres }: { room: WorldRoom; tileMetres: number }) {
  const text: SignText = {
    name: room.name,
    working: room.robotsWorking,
    waiting: room.robotsWaiting,
    building: room.buildState === "building",
    locked: !room.enterable,
  };
  const key = JSON.stringify(text);
  const texture = useMemo(() => createSignTexture(text), [key]);
  useEffect(() => () => texture?.dispose(), [texture]);
  const c = doorCentre(room, tileMetres);
  const o = OUTWARD[room.doorSide];
  // Along the wall, to the left as you face the door from the corridor.
  const along = { x: o.z, z: -o.x };
  return (
    <mesh
      name={`room-sign-${room.id}`}
      position={[
        c.x + o.x * OUT + along.x * SIGN_ALONG,
        SIGN_Y,
        c.z + o.z * OUT + along.z * SIGN_ALONG,
      ]}
      rotation-y={o.yaw}
      raycast={() => null}
    >
      <planeGeometry args={[SIGN_W, SIGN_H]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

export function RoomSigns({
  world,
  visible,
}: {
  world: CompoundWorld;
  visible: ReadonlySet<string>;
}) {
  const rooms = world.rooms.filter((r) => r.kind === "project" && visible.has(r.id));
  return (
    <group name="room-signs">
      {rooms.map((r) => (
        <Plaque key={r.id} room={r} tileMetres={world.tileMetres} />
      ))}
    </group>
  );
}

const capGeometry = new BoxGeometry(1, 1, 1);
const CAP_THICK = 0.3;

/** A slab of rock over every visible room the viewer may not see into. */
export function LockedCaps({ rooms }: { rooms: readonly WorldRoom[] }) {
  const ref = useRef<InstancedMesh>(null);
  const material = useMemo(() => new MeshLambertMaterial({ color: LAIR.rockCut }), []);
  useEffect(() => () => material.dispose(), [material]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    rooms.forEach((r, i) => {
      const t = WALL_THICKNESS;
      m.makeScale(r.size.w + 2 * t, CAP_THICK, r.size.d + 2 * t);
      m.setPosition(
        r.origin.x + r.size.w / 2,
        WALL_HEIGHT + CAP_THICK / 2,
        r.origin.z + r.size.d / 2,
      );
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [rooms]);
  if (rooms.length === 0) return null;
  return (
    <instancedMesh
      key={rooms.length}
      ref={ref}
      name="locked-caps"
      args={[capGeometry, material, rooms.length]}
      raycast={() => null}
    />
  );
}
