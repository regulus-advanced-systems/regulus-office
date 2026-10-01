/**
 * Turntable preview of the draft genius: a small canvas of its own with the
 * genius slowly turning (still under reduced motion). Keyboard: focus the
 * preview and use Left/Right to turn it; the pose button cycles emotes.
 */
import { Canvas, useFrame } from "@react-three/fiber";
import type { AvatarAnimation, GeniusLookValue } from "@regulus/protocol";
import { type KeyboardEvent, useRef, useState } from "react";
import type { Group } from "three";
import { GeniusAvatar } from "../../scene/geniuses/GeniusAvatar.tsx";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";

/** Radians per second of the automatic turn. */
const TURN_SPEED = 0.55;
/** Radians per arrow key press. */
const TURN_STEP = Math.PI / 8;
/** Start three-quarters on: the face and the silhouette both read. */
const START_YAW = Math.PI - 0.5;
export const PREVIEW_POSES: readonly AvatarAnimation[] = [
  "idle",
  "wave",
  "celebrate",
  "point",
  "think",
  "walk",
];

function Spinner({
  look,
  pose,
  yaw,
  spin,
}: {
  look: GeniusLookValue;
  pose: AvatarAnimation;
  yaw: { current: number };
  spin: boolean;
}) {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (spin) yaw.current += delta * TURN_SPEED;
    if (group.current) group.current.rotation.y = yaw.current;
  });
  return (
    <group ref={group} name="genius-preview">
      <GeniusAvatar look={look} animation={pose} />
    </group>
  );
}

export function TurntablePreview({ look, label }: { look: GeniusLookValue; label: string }) {
  const reducedMotion = useUiStore(selectReducedMotion);
  const yaw = useRef(START_YAW);
  const [manual, setManual] = useState(false);
  const [poseIndex, setPoseIndex] = useState(0);
  const pose = PREVIEW_POSES[poseIndex] ?? "idle";
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setManual(true);
    yaw.current += e.key === "ArrowLeft" ? -TURN_STEP : TURN_STEP;
  };
  return (
    <div className="rg-genius-preview">
      <div
        className="rg-genius-preview__stage"
        role="img"
        aria-label={`${label}. Use the left and right arrow keys to turn.`}
        tabIndex={0}
        onKeyDown={onKey}
        data-testid="genius-preview"
      >
        <Canvas
          dpr={1}
          camera={{ position: [0, 1.5, 5.6], fov: 32 }}
          onCreated={({ camera }) => camera.lookAt(0, 1.1, 0)}
        >
          <hemisphereLight args={["#FFE9C7", "#4A4038", 1.15]} />
          <directionalLight position={[3, 6, 5]} intensity={2.1} color="#FFD9A0" />
          <directionalLight position={[-4, 3, -3]} intensity={0.6} color="#9FC3D9" />
          <mesh rotation-x={-Math.PI / 2}>
            <circleGeometry args={[0.9, 24]} />
            <meshToonMaterial color="#6E665B" />
          </mesh>
          <Spinner look={look} pose={pose} yaw={yaw} spin={!reducedMotion && !manual} />
        </Canvas>
      </div>
      <div className="rg-genius-preview__controls">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Turn left"
          onClick={() => {
            setManual(true);
            yaw.current -= TURN_STEP;
          }}
        >
          ◀
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setPoseIndex((i) => (i + 1) % PREVIEW_POSES.length)}
        >
          Pose: {pose}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Turn right"
          onClick={() => {
            setManual(true);
            yaw.current += TURN_STEP;
          }}
        >
          ▶
        </Button>
      </div>
    </div>
  );
}
