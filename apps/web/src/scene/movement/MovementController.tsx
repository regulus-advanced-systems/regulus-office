/**
 * Drives the local player inside the office canvas (SPEC §9.2): builds the
 * nav grid for the floor template, spawns at its spawn point, turns WASD
 * into camera-relative steps, turns floor clicks into A* paths, follows
 * them each frame and relays the pose as `move` at no more than 20 Hz.
 * Mount as a child of <OfficeCanvas>; the avatar itself is drawn by
 * scene/avatars/AvatarLayer.tsx from the same store.
 */
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import type { FloorTemplate } from "@regulus/floor-layout";
import { useEffect, useMemo } from "react";
import { useFootsteps } from "../../audio/footsteps.ts";
import { getOfficeClient } from "../../net/index.ts";
import { useConnectionStore } from "../../state/connection.ts";
import { usePlayerStore } from "../../state/player.ts";
import type { Pose } from "./kinematics.ts";
import { createMoveThrottle } from "./moveThrottle.ts";
import { navGridFor, planPath } from "./navigation.ts";
import { useWasdInput } from "./useWasdInput.ts";
import { inputVector } from "./wasd.ts";

/** Frames longer than this (tab switch, hitch) are clamped so the avatar never teleports. */
const MAX_FRAME_SECONDS = 0.1;

export interface MovementControllerProps {
  template: FloorTemplate;
  /** Where poses go; defaults to the shared office client. */
  send?: (pose: Pose) => void;
}

function sendMove(pose: Pose): void {
  try {
    getOfficeClient().send("move", { x: pose.x, z: pose.z, heading: pose.heading });
  } catch {
    // Not joined yet; the throttle is reset when the connection comes back.
  }
}

export function MovementController({ template, send = sendMove }: MovementControllerProps) {
  const grid = useMemo(() => navGridFor(template), [template]);
  const keys = useWasdInput();
  const throttle = useMemo(() => createMoveThrottle({ send }), [send]);
  useFootsteps();

  useEffect(() => {
    const store = usePlayerStore.getState();
    store.setNavigation({
      walkable: (x, z) => grid.isWalkable(x, z),
      plan: (from, to) => planPath(grid, from, to),
    });
    if (!store.spawned) store.spawnAt(template.spawn);
    return () => usePlayerStore.getState().setNavigation(null);
  }, [grid, template]);

  // After a (re)connect the server holds no pose for us: re-send the current one.
  useEffect(() => {
    if (useConnectionStore.getState().status === "connected") throttle.reset();
    return useConnectionStore.subscribe((s, prev) => {
      if (s.status === "connected" && prev.status !== "connected") throttle.reset();
    });
  }, [throttle]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, MAX_FRAME_SECONDS);
    const store = usePlayerStore.getState();
    const input = inputVector(keys.current);
    if (input.x !== 0 || input.z !== 0) store.applyInput(input.x, input.z, dt);
    else store.advance(dt);
    throttle.update(usePlayerStore.getState());
    throttle.tick();
  });

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.nativeEvent.button !== 0) return; // right-click is the context menu (§9.2)
    usePlayerStore.getState().setTarget(event.point.x, event.point.z);
  };

  return (
    <mesh
      name="walk-plane"
      rotation-x={-Math.PI / 2}
      position={[template.size.width / 2, 0.001, template.size.depth / 2]}
      onClick={onClick}
    >
      <planeGeometry args={[template.size.width, template.size.depth]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
