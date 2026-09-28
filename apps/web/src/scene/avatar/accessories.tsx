/**
 * Head accessories (antenna, visor, cap), the status antenna bulb, the human
 * badge and the agent chest light (SPEC §9.3). Geometries are module-level
 * singletons and materials come from the toon/unlit caches, so 20 robots add
 * no per-instance GPU resources beyond their cloned skeletons.
 */
import { BoxGeometry, CylinderGeometry, SphereGeometry } from "three";
import type { Accessory, ColorSet } from "./colorSets.ts";
import { toonMaterialFor, unlitMaterialFor } from "./toonMaterial.ts";

/**
 * Head-bone-local geometry of the model (armature units, i.e. the x100 armature
 * scale already applied by the parent). Measured on robot.glb: the head is a
 * rounded cube of about HEAD_RADIUS around the bone origin, the face on +Z.
 */
export const HEAD_RADIUS = 0.62;
export const HEAD_TOP = 0.9;
export const HEAD_FRONT = 0.62;
export const EYE_HEIGHT = 0.18;
/** Body-bone-local chest point (in front of the torso panel). */
export const CHEST = { x: 0, y: 0.55, z: 0.42 } as const;

const ANTENNA_HEIGHT = 0.42;
const BULB_RADIUS = 0.14;
const ANTENNA_GEOMETRY = new CylinderGeometry(0.035, 0.035, ANTENNA_HEIGHT, 6);
const BULB_GEOMETRY = new SphereGeometry(BULB_RADIUS, 12, 8);
const VISOR_GEOMETRY = new CylinderGeometry(
  HEAD_RADIUS + 0.04,
  HEAD_RADIUS + 0.04,
  0.22,
  20,
  1,
  true,
  -Math.PI * 0.42,
  Math.PI * 0.84,
);
const CAP_GEOMETRY = new CylinderGeometry(HEAD_RADIUS * 0.78, HEAD_RADIUS * 0.92, 0.2, 16);
const BRIM_GEOMETRY = new BoxGeometry(0.7, 0.05, 0.36);
const BADGE_GEOMETRY = new BoxGeometry(0.28, 0.36, 0.05);
const BADGE_STRIPE_GEOMETRY = new BoxGeometry(0.2, 0.08, 0.06);
const CHEST_LIGHT_GEOMETRY = new SphereGeometry(0.11, 12, 8);
const DARK = "#3A3A40";

export type AntennaProps = { bulbColor: string; lit: boolean; colors: ColorSet };

/** Antenna stalk with a bulb; the bulb is unlit (lamp-like) unless the status is dark. */
export function Antenna({ bulbColor, lit, colors }: AntennaProps) {
  const y = HEAD_TOP + ANTENNA_HEIGHT / 2;
  return (
    <group>
      <mesh geometry={ANTENNA_GEOMETRY} material={toonMaterialFor(DARK)} position={[0, y, 0]} />
      <mesh
        name="bulb"
        geometry={BULB_GEOMETRY}
        material={lit ? unlitMaterialFor(bulbColor) : toonMaterialFor(bulbColor)}
        position={[0, HEAD_TOP + ANTENNA_HEIGHT + BULB_RADIUS * 0.6, 0]}
        userData={{ accent: colors.accent }}
      />
    </group>
  );
}

export function Visor({ colors }: { colors: ColorSet }) {
  return (
    <mesh
      geometry={VISOR_GEOMETRY}
      material={toonMaterialFor(colors.accent)}
      position={[0, EYE_HEIGHT, 0]}
    />
  );
}

export function Cap({ colors }: { colors: ColorSet }) {
  return (
    <group position={[0, HEAD_TOP + 0.06, 0]}>
      <mesh geometry={CAP_GEOMETRY} material={toonMaterialFor(colors.accent)} />
      <mesh
        geometry={BRIM_GEOMETRY}
        material={toonMaterialFor(colors.secondary)}
        position={[0, -0.08, HEAD_RADIUS * 0.6]}
      />
    </group>
  );
}

export function HeadAccessory({ accessory, colors }: { accessory: Accessory; colors: ColorSet }) {
  if (accessory === "visor") return <Visor colors={colors} />;
  if (accessory === "cap") return <Cap colors={colors} />;
  return null;
}

/** Lanyard badge that marks a human (SPEC §9.3 "badge mesh"). */
export function Badge({ colors }: { colors: ColorSet }) {
  return (
    <group position={[CHEST.x + 0.22, CHEST.y - 0.05, CHEST.z]} name="badge">
      <mesh geometry={BADGE_GEOMETRY} material={toonMaterialFor("#FFFFFF")} />
      <mesh
        geometry={BADGE_STRIPE_GEOMETRY}
        material={toonMaterialFor(colors.accent)}
        position={[0, 0.1, 0.01]}
      />
    </group>
  );
}

/** Provider-coloured lamp on an agent's chest. */
export function ChestLight({ color }: { color: string }) {
  return (
    <mesh
      name="chestLight"
      geometry={CHEST_LIGHT_GEOMETRY}
      material={unlitMaterialFor(color)}
      position={[CHEST.x, CHEST.y, CHEST.z]}
    />
  );
}
