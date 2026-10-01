/**
 * The lair kit's materials (#183, SPEC §12): every piece is vertex-coloured,
 * so the whole kit needs only four materials, created once per scene and
 * shared by every instanced mesh:
 *
 * - `body`: MeshToonMaterial on the avatars' 4-step ramp (avatar/
 *   toonMaterial.ts), so the rooms shade exactly like the henchmen (#184)
 *   standing in them;
 * - `glow`: unlit MeshBasicMaterial for bulbs, screens, lamps and lenses;
 * - `cutBody` / `cutGlow`: the same with the cutaway patch (cutaway.ts),
 *   for walls and wall-mounted pieces.
 */
import { DataTexture, MeshBasicMaterial, MeshToonMaterial } from "three";
import { getGradientMap, TOON_STEPS, toonRampValues } from "../avatar/toonMaterial.ts";
import { applyCutaway, type CutawayUniforms, createCutawayUniforms } from "./cutaway.ts";

/** The lair shares the henchmen's toon ramp: 4 bands, the darkest at 45 %. */
export const LAIR_TOON_STEPS = TOON_STEPS;
export const LAIR_TOON_DARKEST = (toonRampValues()[0] ?? 115) / 255;

export interface LairMaterials {
  body: MeshToonMaterial;
  glow: MeshBasicMaterial;
  cutBody: MeshToonMaterial;
  cutGlow: MeshBasicMaterial;
  /** The shared avatar ramp (owned by avatar/toonMaterial.ts; never disposed here). */
  ramp: DataTexture;
  cutaway: CutawayUniforms;
}

export function createLairMaterials(
  cutaway: CutawayUniforms = createCutawayUniforms(),
): LairMaterials {
  const ramp = getGradientMap();
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
}
