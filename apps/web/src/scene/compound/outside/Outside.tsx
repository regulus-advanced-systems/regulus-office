/**
 * Outside the blast door (SPEC §9.1 Outside, §11, §12; #188): the portal on
 * the mountain face, the beach cove, the sea, the dock with its boat, palms
 * and rocks, and the blast door itself with its buttons. Cheap by design:
 * the static outside is three baked meshes (sand, props, portal) plus the
 * sea and the boat, about ten draws in all.
 *
 * Culling: the beach, sea, props and boat are drawn only while the camera
 * can see the outside (checked 4×/s) and the player is near enough, or the
 * camera is at the overview; deep in the compound none of it is drawn. The
 * software-WebGL tier also draws a smaller sea with a plain vertex-coloured
 * material (no shader work per pixel), the sand, props and boat unlit with
 * their light baked in, and only when the player is within the tier's draw
 * distance. The portal and the door are part of the lobby's
 * wall and always mounted (three's frustum culling skips them off screen).
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { type BufferGeometry, type Group, MeshBasicMaterial } from "three";
import { usePlayerStore } from "../../../state/player.ts";
import { useUiStore } from "../../../state/ui.ts";
import { useLairMaterials } from "../../lair/components/LairKit.tsx";
import type { Bounds } from "../placed.ts";
import { LOW_DRAW_DISTANCE, useQualityStore } from "../quality.ts";
import { boundsVisible, frustumOf, useVisibleStore } from "../visibility.ts";
import { ambienceLevel, createAmbience } from "./audio/ambience.ts";
import { outsideAudio } from "./audio/synth.ts";
import { BlastDoor } from "./BlastDoor.tsx";
import { boatGeometry } from "./boat.ts";
import { ButtonPanels, useBlastDoorNotices } from "./buttons.tsx";
import { useDoorPassable } from "./doorState.ts";
import { type OutsideLayout, SEA_LEVEL } from "./layout.ts";
import { bakeLight } from "./Mountain.tsx";
import { portalGeometry } from "./portal.ts";
import { beachProps } from "./props.ts";
import { createSeaMaterial } from "./seaMaterial.ts";
import { sandGeometry, seaGeometry } from "./water.ts";

const CHECK_S = 0.25;
/** Beyond this distance from the outside (metres) it is not drawn, unless at the overview. */
export const OUTSIDE_NEAR = 70;

/** Ground distance from a point to a box. */
export function distanceTo(b: Bounds, x: number, z: number): number {
  return Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
}

/** Whether to draw the outside: on screen, and near enough (or the overview). */
export function outsideWanted(opts: {
  inFrustum: boolean;
  distance: number;
  far: boolean;
  low: boolean;
}): boolean {
  if (!opts.inFrustum) return false;
  if (opts.low) return opts.distance <= LOW_DRAW_DISTANCE;
  return opts.far || opts.distance <= OUTSIDE_NEAR;
}

/** What the outside drew on the last check, for the e2e probe and the perf notes. */
export const outsideView = { drawn: false };

export function Outside({ layout }: { layout: OutsideLayout }) {
  const mats = useLairMaterials();
  const quality = useQualityStore((s) => s.quality);
  const low = quality === "low";
  // The software tier draws the beach unlit, with the light baked into its colours.
  const bake = (g: BufferGeometry): BufferGeometry => (low ? bakeLight(g) : g);
  const sand = useMemo(() => bake(sandGeometry(layout)), [layout, low]);
  const sea = useMemo(
    () => (low ? seaGeometry(layout, { halfWidth: 70, reach: 56 }) : seaGeometry(layout)),
    [layout, low],
  );
  const props = useMemo(() => {
    const p = beachProps(layout);
    return { ...p, body: bake(p.body) };
  }, [layout, low]);
  const portal = useMemo(() => portalGeometry(layout, { low }), [layout, low]);
  const boat = useMemo(() => bake(boatGeometry()), [low]);
  const lit = low ? mats.glow : mats.body;
  const seaMaterial = useMemo(
    () => (low ? new MeshBasicMaterial({ vertexColors: true }) : createSeaMaterial()),
    [low],
  );
  useEffect(
    () => () => {
      for (const g of [sand, sea, props.body, props.glow, portal.body, portal.glow, boat])
        g?.dispose();
    },
    [sand, sea, props, portal, boat],
  );
  useEffect(() => () => seaMaterial.dispose(), [seaMaterial]);
  useBlastDoorNotices(layout);

  const beach = useRef<Group>(null);
  const boatRef = useRef<Group>(null);
  const since = useRef(Number.POSITIVE_INFINITY);
  useFrame((state, dt) => {
    since.current += dt;
    if (since.current >= CHECK_S && beach.current) {
      since.current = 0;
      const p = usePlayerStore.getState();
      state.camera.updateMatrixWorld();
      const wanted = outsideWanted({
        inFrustum: boundsVisible(frustumOf(state.camera), layout.bounds),
        distance: distanceTo(layout.bounds, p.x, p.z),
        far: useVisibleStore.getState().far,
        low,
      });
      beach.current.visible = wanted;
      outsideView.drawn = wanted;
    }
    if (!beach.current?.visible) return;
    const t = state.clock.elapsedTime;
    if ("uniforms" in seaMaterial) seaMaterial.uniforms.uTime.value = t;
    const b = boatRef.current;
    if (b) {
      b.position.y = SEA_LEVEL + 0.32 + Math.sin(t * 1.1) * 0.05;
      b.rotation.z = Math.sin(t * 0.8) * 0.025;
      b.rotation.x = Math.sin(t * 0.9 + 1) * 0.015;
    }
  });

  return (
    <group name="outside">
      <mesh
        name="outside-portal"
        geometry={portal.body}
        material={mats.cutBody}
        raycast={() => null}
      />
      {portal.glow && <mesh geometry={portal.glow} material={mats.cutGlow} raycast={() => null} />}
      <BlastDoor layout={layout} />
      <ButtonPanels layout={layout} />
      <group ref={beach} name="outside-beach" visible={false}>
        <mesh name="outside-sand" geometry={sand} material={lit} raycast={() => null} />
        <mesh name="outside-sea" geometry={sea} material={seaMaterial} raycast={() => null} />
        <mesh name="outside-props" geometry={props.body} material={lit} raycast={() => null} />
        {props.glow && <mesh geometry={props.glow} material={mats.glow} raycast={() => null} />}
        <group
          ref={boatRef}
          name="outside-boat"
          position={[layout.boat.x, SEA_LEVEL + 0.32, layout.boat.z]}
          rotation-y={layout.boat.heading}
        >
          <mesh geometry={boat} material={lit} raycast={() => null} />
        </group>
      </group>
      <OutsideAudio layout={layout} />
    </group>
  );
}

/** Surf and gulls (audio/ambience.ts), following the player 4×/s; silent when muted. */
function OutsideAudio({ layout }: { layout: OutsideLayout }) {
  const ambience = useMemo(() => createAmbience(outsideAudio), []);
  const open = useDoorPassable();
  const openRef = useRef(open);
  openRef.current = open;
  const since = useRef(0);
  useEffect(() => {
    // A hidden tab stops rendering, and with it these updates: stop the sea too.
    const onHide = () => {
      if (document.hidden) ambience.stop();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      ambience.stop();
    };
  }, [ambience]);
  useFrame((_, dt) => {
    since.current += dt;
    if (since.current < CHECK_S) return;
    since.current = 0;
    const p = usePlayerStore.getState();
    const volume = useUiStore.getState().settings.volume;
    const level = p.spawned && volume > 0 ? volume * ambienceLevel(layout, p, openRef.current) : 0;
    ambience.update(level);
  });
  return null;
}
