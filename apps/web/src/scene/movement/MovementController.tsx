/**
 * Drives the local player inside the office canvas (SPEC §9.2): walks the
 * given nav grid (the compound's, #186, or one floor template's in the dev
 * harnesses), spawns at the spawn pose, turns WASD into steps relative to
 * the camera's yaw, turns floor clicks into A* paths, follows
 * them each frame and relays the pose as `move` at no more than 20 Hz.
 * Holding Shift runs (WASD or a click path) and a double-click runs to the
 * spot (#223): the first click of the pair already set off walking, the
 * double-click upgrades the same path to a run.
 * While standing in third person the robot turns toward the floor point
 * under the mouse (#119); that heading-only change goes out as `move` too.
 * Mount as a child of <OfficeCanvas>; the avatar itself is drawn by
 * scene/avatars/AvatarLayer.tsx from the same store.
 */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import type { RoomTemplate, NavGrid, Rect } from "@regulus/room-layout";
import { useEffect, useMemo } from "react";
import { Raycaster, Vector2 } from "three";
import { useFootsteps } from "../../audio/footsteps.ts";
import { getOfficeClient } from "../../net/index.ts";
import { cameraView } from "../../state/camera.ts";
import { useConnectionStore } from "../../state/connection.ts";
import { usePlayerStore } from "../../state/player.ts";
import { useUiStore } from "../../state/ui.ts";
import { useViewStore } from "../../state/view.ts";
import { groundPointFromRay } from "./cursorFacing.ts";
import { selectSpeed } from "./gait.ts";
import type { Pose } from "./kinematics.ts";
import { createMoveThrottle } from "./moveThrottle.ts";
import { navGridFor, nearestWalkable, planPath } from "./navigation.ts";
import { useCursorGround } from "./useCursorGround.ts";
import { useWasdInput } from "./useWasdInput.ts";
import { inputVector } from "./wasd.ts";

/** Frames longer than this (tab switch, hitch) are clamped so the avatar never teleports. */
const MAX_FRAME_SECONDS = 0.1;

export interface MovementControllerProps {
  grid: NavGrid;
  /** Where the player appears when first spawned, or when `spawnKey` changes. */
  spawn: Pose;
  /** Identity of the world being walked; a new key respawns the player at `spawn`. */
  spawnKey: string;
  /** The clickable ground, metres (the whole compound plus its beach). */
  plane: Rect;
  /** Where poses go; defaults to the shared office client. */
  send?: (pose: Pose) => void;
  /** Whether running is allowed right now (not in build mode, where Shift is taken). */
  canRun?: () => boolean;
}

const always = () => true;

function sendMove(pose: Pose): void {
  try {
    getOfficeClient().send("move", { x: pose.x, z: pose.z, heading: pose.heading });
  } catch {
    // Not joined yet; the throttle is reset when the connection comes back.
  }
}

/** One floor template's grid, spawn and floor (the dev harnesses' single-room scenes). */
export function TemplateMovement({
  template,
  send,
}: {
  template: RoomTemplate;
  send?: (pose: Pose) => void;
}) {
  const grid = useMemo(() => navGridFor(template), [template]);
  const plane = useMemo(
    () => ({ x: 0, z: 0, w: template.size.width, d: template.size.depth }),
    [template],
  );
  return (
    <MovementController
      grid={grid}
      spawn={template.spawn}
      spawnKey={template.id}
      plane={plane}
      send={send}
    />
  );
}

export function MovementController({
  grid,
  spawn,
  spawnKey,
  plane,
  send = sendMove,
  canRun = always,
}: MovementControllerProps) {
  const keys = useWasdInput();
  const throttle = useMemo(() => createMoveThrottle({ send }), [send]);
  const cursor = useCursorGround();
  const ray = useMemo(() => ({ caster: new Raycaster(), ndc: new Vector2() }), []);
  useFootsteps();

  useEffect(() => {
    const store = usePlayerStore.getState();
    store.setNavigation({
      walkable: (x, z) => grid.isWalkable(x, z),
      plan: (from, to) => planPath(grid, from, to),
    });
    if (!store.spawned || store.spawnKey !== spawnKey) store.spawnAt(spawn, spawnKey);
    // The ground moved under us (our room was archived or moved): back to the spawn point.
    else if (!nearestWalkable(grid, { x: store.x, z: store.z })) store.spawnAt(spawn, spawnKey);
    return () => usePlayerStore.getState().setNavigation(null);
  }, [grid, spawn, spawnKey]);

  // After a (re)connect the server holds no pose for us: re-send the current one.
  useEffect(() => {
    if (useConnectionStore.getState().status === "connected") throttle.reset();
    return useConnectionStore.subscribe((s, prev) => {
      if (s.status === "connected" && prev.status !== "connected") throttle.reset();
    });
  }, [throttle]);

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, MAX_FRAME_SECONDS);
    const store = usePlayerStore.getState();
    // In first person the FPV rig (scene/fpv) drives the store with camera-relative WASD.
    const firstPerson = useViewStore.getState().mode === "first_person";
    if (!firstPerson) {
      const shift = keys.current.run && canRun();
      const input = inputVector(keys.current, (cameraView.yaw * 180) / Math.PI);
      if (input.x !== 0 || input.z !== 0)
        store.applyInput(input.x, input.z, dt, selectSpeed({ shift, pathRun: false }));
      else {
        store.advance(dt, shift);
        // Standing still: face the floor point under the cursor.
        const ndc = cursor.active({
          overlayOpen: useUiStore.getState().overlay !== null,
          firstPerson,
        });
        if (ndc) {
          ray.caster.setFromCamera(ray.ndc.set(ndc.x, ndc.y), camera);
          const point = groundPointFromRay(ray.caster.ray.origin, ray.caster.ray.direction);
          if (point) usePlayerStore.getState().faceToward(point.x, point.z, dt);
        }
      }
    }
    throttle.update(usePlayerStore.getState());
    throttle.tick();
  });

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return; // right-click is the context menu (§9.2)
    if (useViewStore.getState().mode === "first_person") return; // that click re-locks the pointer
    usePlayerStore.getState().setTarget(event.point.x, event.point.z);
  };

  // The pair's clicks already set off walking there; the double-click upgrades it to a run.
  const onDoubleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return;
    if (useViewStore.getState().mode === "first_person") return;
    usePlayerStore.getState().setTarget(event.point.x, event.point.z, canRun());
  };

  return (
    <mesh
      name="walk-plane"
      // Hit target only: invisible objects still take pointer events but cost no draw call.
      visible={false}
      rotation-x={-Math.PI / 2}
      position={[plane.x + plane.w / 2, 0.001, plane.z + plane.d / 2]}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <planeGeometry args={[plane.w, plane.d]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
