/**
 * The turntable of one henchman in the skin rule editor (#184, #225): the
 * skin with a provider's trim, idling under the office's light. Loaded lazily
 * so Settings does not pull three.js in until an admin opens the section.
 */
import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { HenchmanAvatar } from "../../scene/henchmen/HenchmanAvatar.tsx";
import { HEMI_GROUND, HEMI_SKY, KEY_INTENSITY } from "../../scene/lights/Lighting.tsx";

export interface SkinPreviewProps {
  skin: string;
  trim: string | undefined;
}

function Turntable({ skin, trim }: SkinPreviewProps) {
  const spin = useRef<Group>(null);
  useFrame((_, delta) => {
    if (spin.current) spin.current.rotation.y += delta * 0.6;
  });
  return (
    <group ref={spin}>
      <HenchmanAvatar skin={skin} trim={trim} animation="idle" status="working" />
    </group>
  );
}

export default function SkinPreview({ skin, trim }: SkinPreviewProps) {
  return (
    <div className="rg-skin-editor__stage" role="img" aria-label={`Preview of the ${skin} skin`}>
      <Canvas
        orthographic
        flat
        dpr={1}
        camera={{ position: [0, 1.7, 6], zoom: 112, near: 0.1, far: 50 }}
        onCreated={({ camera }) => camera.lookAt(0, 0.88, 0)}
      >
        <hemisphereLight args={[HEMI_SKY, HEMI_GROUND, 1.15]} />
        <directionalLight position={[-3, 5, 4]} intensity={KEY_INTENSITY} />
        <Turntable skin={skin} trim={trim} />
      </Canvas>
    </div>
  );
}
