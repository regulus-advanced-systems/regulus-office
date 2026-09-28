/**
 * Placeholder scene: true-isometric orthographic camera (yaw 45°, pitch
 * 35.264°, SPEC §12), hemisphere + key light from the upper left, a lit
 * ground plane and one box so the lighting is visible. The real floor scene
 * is issue #14.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { colors } from "../ui/theme.ts";

/** Camera direction for a true isometric view. */
const ISO_DISTANCE = 20;
const ISO_POSITION: [number, number, number] = [
  ISO_DISTANCE * Math.SQRT1_2,
  ISO_DISTANCE * Math.tan((35.264 * Math.PI) / 180) * Math.SQRT2 * Math.SQRT1_2,
  ISO_DISTANCE * Math.SQRT1_2,
];

export function OfficeCanvas() {
  return (
    <Canvas
      orthographic
      shadows
      camera={{ position: ISO_POSITION, zoom: 40, near: 0.1, far: 200 }}
      style={{ position: "absolute", inset: 0 }}
    >
      <hemisphereLight args={["#ffffff", colors.cream, 0.9]} />
      <directionalLight
        position={[-8, 12, 6]}
        intensity={1.4}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[16, 12]} />
        <meshToonMaterial color="#D8C79A" />
      </mesh>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshToonMaterial color={colors.cyan} />
      </mesh>
      <OrbitControls enableRotate={false} makeDefault />
    </Canvas>
  );
}
