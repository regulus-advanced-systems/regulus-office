/**
 * The lobby's blast door (#188, SPEC §9.1, §9.4): two heavy riveted leaves
 * that shudder on their bolts and then slide into the wall, rotating red
 * warning beacons inside and on the portal (dome sweep, turning light beams
 * and, on a GPU, two red lights that wash the rock), the klaxon and the
 * door's machinery, all driven by the shared phase in the BuildingRoom.
 * Pressing is `ButtonPanels`' job (buttons.tsx). Everything animated is
 * written straight to instance matrices each frame: no re-renders.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  type InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  type PointLight,
} from "three";
import { usePlayerStore } from "../../../state/player.ts";
import { useUiStore } from "../../../state/ui.ts";
import { Beacons } from "../../lair/components/Beacons.tsx";
import { useLairMaterials } from "../../lair/components/LairKit.tsx";
import { WALL_HEIGHT } from "../../lair/dimensions.ts";
import { LAIR } from "../../lair/palette.ts";
import { type PiecePlacement, placementMatrix } from "../../lair/placements.ts";
import { useQualityStore } from "../quality.ts";
import { playDoorMachinery, playKlaxon } from "./audio/klaxon.ts";
import { doorLoudness, outsideAudio } from "./audio/synth.ts";
import {
  alarmOn,
  currentDoor,
  DOOR_TRAVEL_S,
  DOOR_UNLOCK_S,
  type LeafMotion,
  leafOffset,
  leavesMoving,
  SHUT,
  stepLeaves,
  useDoorOverride,
} from "./doorState.ts";
import type { OutsideLayout } from "./layout.ts";
import { LEAF, leafGeometry } from "./portal.ts";

/** What the door shows right now, for the e2e probe (written every frame). */
export const doorView = { travel: 0, alarm: false, moving: false };

/** A beacon's light beam: two opposed blades, each a horizontal and a vertical fan. */
function beamGeometry(): BufferGeometry {
  const pos: number[] = [];
  const L = 3.2;
  const W = 0.55;
  for (const dir of [1, -1]) {
    pos.push(0, 0, 0, dir * L, 0, -W, dir * L, 0, W);
    pos.push(0, 0, 0, dir * L, -W, 0, dir * L, W, 0);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.computeBoundingSphere();
  return geo;
}

function loudness(layout: OutsideLayout): number {
  const p = usePlayerStore.getState();
  return doorLoudness(Math.hypot(p.x - layout.door.centre, p.z - layout.edgeZ));
}

export function BlastDoor({ layout }: { layout: OutsideLayout }) {
  const mats = useLairMaterials();
  const quality = useQualityStore((s) => s.quality);
  const forcedAlarm = useDoorOverride((s) => s.alarm);
  const leaf = useMemo(leafGeometry, []);
  const beam = useMemo(beamGeometry, []);
  const beamMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color(LAIR.red),
        transparent: true,
        opacity: 0.3,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      for (const g of [leaf.body, leaf.glow, beam]) g?.dispose();
      beamMaterial.dispose();
    },
    [leaf, beam, beamMaterial],
  );
  const bodyRef = useRef<InstancedMesh>(null);
  const glowRef = useRef<InstancedMesh>(null);
  const beamRef = useRef<InstancedMesh>(null);
  const lightRefs = useRef<(PointLight | null)[]>([]);
  const motion = useRef<LeafMotion>(SHUT);
  /** The travel last written to the leaves' matrices (-1: rewrite next frame). */
  const written = useRef(-1);
  const sinceShut = useRef(Number.POSITIVE_INFINITY);
  const lastPhase = useRef<string | null>(null);
  const [alarm, setAlarm] = useState(false);

  const z = layout.edgeZ + 0.18;
  const { x0, x1, centre } = layout.door;
  const beacons = useMemo<Omit<PiecePlacement, "piece">[]>(() => {
    const top = 4.4 + 0.2;
    const zc = layout.edgeZ + 0.64;
    return [
      { position: [x0 - 0.75, WALL_HEIGHT - 0.35, layout.edgeZ - 0.3], rotationY: Math.PI },
      { position: [x1 + 0.75, WALL_HEIGHT - 0.35, layout.edgeZ - 0.3], rotationY: Math.PI },
      { position: [x0 - 0.45, top, zc], rotationY: 0 },
      { position: [x1 + 0.45, top, zc], rotationY: 0 },
    ];
  }, [layout, x0, x1]);
  const lights = useMemo(
    () => [
      [centre, 2.6, layout.edgeZ - 1.6],
      [centre, 4.2, layout.edgeZ + 2.4],
    ],
    [centre, layout.edgeZ],
  );

  // A door already open when we arrive shows open; nothing plays.
  useEffect(() => {
    const open = currentDoor().phase !== "closed";
    motion.current = open ? { travel: 1, unlock: 0, open: true } : SHUT;
    lastPhase.current = currentDoor().phase;
  }, []);

  const m = useMemo(() => new Matrix4(), []);
  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.1);
    const door = currentDoor();
    const phase = door.phase;
    const before = motion.current;
    const next = stepLeaves(before, phase !== "closed", dt);
    motion.current = next;
    // Sounds on what changed: the klaxon on opening and on the warning, the machinery on travel.
    const prev = lastPhase.current;
    if (prev !== null && prev !== phase) {
      const ui = useUiStore.getState();
      const opts = { volume: ui.settings.volume, loudness: loudness(layout) };
      if (phase === "open" && prev === "closed") {
        playKlaxon(3, opts, outsideAudio());
        playDoorMachinery(DOOR_UNLOCK_S + DOOR_TRAVEL_S, false, opts, outsideAudio());
      } else if (phase === "closing") {
        const left = Math.max(1, Math.min(6, (door.closesAt - Date.now()) / 1000));
        playKlaxon(Math.max(1, Math.floor(left / 1.15)), opts, outsideAudio());
      } else if (phase === "closed") {
        playDoorMachinery(DOOR_TRAVEL_S * next.travel, true, opts, outsideAudio());
      }
    }
    lastPhase.current = phase;
    sinceShut.current = phase === "closed" && !leavesMoving(next) ? sinceShut.current + dt : 0;
    const on = alarmOn(phase, next, sinceShut.current, forcedAlarm);
    if (on !== alarm) setAlarm(on);
    doorView.travel = next.travel;
    doorView.alarm = on;
    doorView.moving = leavesMoving(next);

    // Leaves: the left one slides west, the right one (turned round) east; a shudder while moving.
    const off = leafOffset(next.travel) * (LEAF.w - 0.1);
    const shake = leavesMoving(next) ? Math.sin(clock.elapsedTime * 47) * 0.012 : 0;
    const placements: PiecePlacement[] = [
      { piece: "door_leaf", position: [x0 + LEAF.w / 2 - off, shake, z], rotationY: 0 },
      { piece: "door_leaf", position: [x1 - LEAF.w / 2 + off, -shake, z], rotationY: Math.PI },
    ];
    // Still and already written: nothing to upload.
    const still = shake === 0 && written.current === next.travel;
    written.current = still ? written.current : shake === 0 ? next.travel : -1;
    for (const mesh of still ? [] : [bodyRef.current, glowRef.current]) {
      if (!mesh) continue;
      placements.forEach((p, i) => mesh.setMatrixAt(i, placementMatrix(p, m)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    // Beams turn while the alarm runs.
    const beams = beamRef.current;
    if (beams) {
      beams.visible = on;
      if (on) {
        beacons.forEach((b, i) => {
          const yaw = clock.elapsedTime * 4.2 + i * 0.9;
          placementMatrix(
            {
              piece: "beacon",
              position: [b.position[0], b.position[1] + 0.16, b.position[2]],
              rotationY: yaw,
            },
            m,
          );
          beams.setMatrixAt(i, m);
        });
        beams.instanceMatrix.needsUpdate = true;
      }
    }
    lightRefs.current.forEach((l, i) => {
      if (l) l.intensity = on ? 7 * (0.55 + 0.45 * Math.sin(clock.elapsedTime * 8.4 + i * 1.7)) : 0;
    });
  });

  return (
    <group name="blast-door">
      <instancedMesh ref={bodyRef} args={[leaf.body, mats.cutBody, 2]} raycast={() => null} />
      {leaf.glow && (
        <instancedMesh ref={glowRef} args={[leaf.glow, mats.cutGlow, 2]} raycast={() => null} />
      )}
      <Beacons items={beacons} active={alarm} lights={0} />
      <instancedMesh
        ref={beamRef}
        args={[beam, beamMaterial, beacons.length]}
        raycast={() => null}
        frustumCulled={false}
        visible={false}
      />
      {quality === "high" &&
        lights.map((p, i) => (
          <pointLight
            key={p.join(",")}
            ref={(l) => {
              lightRefs.current[i] = l;
            }}
            position={p as [number, number, number]}
            color={LAIR.red}
            intensity={0}
            distance={12}
            decay={1.4}
          />
        ))}
    </group>
  );
}
