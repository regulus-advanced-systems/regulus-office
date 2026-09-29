/**
 * SPEC §12 lighting: one hemisphere light (warm sky, tan ground; a touch
 * warmer since #118 so the rooms read as a lived-in office) and one
 * directional key from the upper left of the screen. No cast shadow maps;
 * contact shadows are baked separately (see OfficeCanvas).
 */
import { colors } from "../../ui/theme.ts";

export const HEMI_SKY = "#FFF4E0";
export const HEMI_GROUND = "#CDB088";
export const HEMI_INTENSITY = 1.15;
export const KEY_INTENSITY = 1.5;
/**
 * Screen-left is world (-x, +z) for the yaw-45° camera, so the key sits at
 * (-x, +y, +z) relative to its target at the origin.
 */
export const KEY_POSITION: readonly [number, number, number] = [-8, 14, 8];

export function Lighting() {
  return (
    <>
      <hemisphereLight args={[HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY]} />
      <directionalLight position={KEY_POSITION} intensity={KEY_INTENSITY} color={colors.cream} />
    </>
  );
}
