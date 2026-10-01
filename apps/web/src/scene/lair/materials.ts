/**
 * The lair kit's materials (#183, SPEC §12): every piece is vertex-coloured,
 * so the whole kit needs only four materials, created once per scene and
 * shared by every instanced mesh:
 *
 * - `body`: MeshToonMaterial with a 4-step ramp that is darker in the
 *   shadow band than the office's (moodier rock, warm pools of light);
 * - `glow`: unlit MeshBasicMaterial for bulbs, screens, lamps and lenses;
 * - `cutBody` / `cutGlow`: the same with the cutaway patch (cutaway.ts),
 *   for walls and wall-mounted pieces.
 */
import { DataTexture, MeshBasicMaterial, MeshToonMaterial } from "three";
import { createGradientMap } from "../materials/toon.ts";
import { applyCutaway, type CutawayUniforms, createCutawayUniforms } from "./cutaway.ts";

/** Lair toon ramp: 4 bands from 38 % (rock in shadow) to full. */
export const LAIR_TOON_STEPS = 4;
export const LAIR_TOON_DARKEST = 0.38;

export interface LairMaterials {
  body: MeshToonMaterial;
  glow: MeshBasicMaterial;
  cutBody: MeshToonMaterial;
  cutGlow: MeshBasicMaterial;
  ramp: DataTexture;
  cutaway: CutawayUniforms;
}

export function createLairMaterials(
  cutaway: CutawayUniforms = createCutawayUniforms(),
): LairMaterials {
  const ramp = createGradientMap(LAIR_TOON_STEPS, LAIR_TOON_DARKEST);
  const body = () =>
    new MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: ramp });
  const glow = () =>
    new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false });
  const b = body();
  b.name = "lair-body";
  const g = glow();
  g.name = "lair-glow";
  const cb = applyCutaway(body(), cutaway);
  cb.name = "lair-body-cutaway";
  const cg = applyCutaway(glow(), cutaway);
  cg.name = "lair-glow-cutaway";
  return { body: b, glow: g, cutBody: cb, cutGlow: cg, ramp, cutaway };
}

export function disposeLairMaterials(m: LairMaterials): void {
  for (const mat of [m.body, m.glow, m.cutBody, m.cutGlow]) mat.dispose();
  m.ramp.dispose();
}
