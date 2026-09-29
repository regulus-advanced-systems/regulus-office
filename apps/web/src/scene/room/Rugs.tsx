/** Draws `rugPieces`: rugs as two flat planes (border + field), patches as one flush plane. */
import type { FloorTemplate, Palette } from "@regulus/floor-layout";
import { useEffect, useMemo } from "react";
import type { MeshToonMaterial } from "three";
import { createToonMaterial } from "../materials/toon.ts";
import { PATCH_Y, RUG_BORDER, RUG_BORDER_Y, RUG_FIELD_Y, rugPieces } from "./rugs.ts";

export function Rugs({ template, palette }: { template: FloorTemplate; palette: Palette }) {
  const pieces = useMemo(() => rugPieces(template.rugs, palette), [template.rugs, palette]);
  const mats = useMemo(() => {
    const byColor = new Map<string, MeshToonMaterial>();
    for (const p of pieces)
      for (const c of [p.color, p.borderColor])
        if (!byColor.has(c)) byColor.set(c, createToonMaterial(c));
    return byColor;
  }, [pieces]);
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);

  return (
    <group name="rugs">
      {pieces.map((p) =>
        p.style === "patch" ? (
          <mesh
            key={p.id}
            position={[p.x, PATCH_Y, p.z]}
            rotation-x={-Math.PI / 2}
            material={mats.get(p.color)}
          >
            <planeGeometry args={[p.width, p.depth]} />
          </mesh>
        ) : (
          <group key={p.id} position={[p.x, 0, p.z]} rotation-x={-Math.PI / 2}>
            <mesh position-z={RUG_BORDER_Y} material={mats.get(p.borderColor)}>
              <planeGeometry args={[p.width, p.depth]} />
            </mesh>
            <mesh position-z={RUG_FIELD_Y} material={mats.get(p.color)}>
              <planeGeometry args={[p.width - 2 * RUG_BORDER, p.depth - 2 * RUG_BORDER]} />
            </mesh>
          </group>
        ),
      )}
    </group>
  );
}
