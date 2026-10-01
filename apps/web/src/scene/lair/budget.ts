/**
 * Draw-call and triangle budget for the lair kit (#183; SPEC §11: 60 fps on
 * a 2020 iGPU at 1080p with 20 robots on screen; SPEC §12 low-poly).
 *
 * Draw calls. Every piece is one vertex-coloured geometry drawn through ONE
 * InstancedMesh per piece type (two when it has an unlit glow layer), with
 * four shared materials. So the kit's cost in draw calls does not grow with
 * the compound: a corridor network of 200 cells costs the same draws as one
 * cell. The ceiling for the whole kit on screen at once is
 *
 *   sum over piece types (1 + glow)        ≈ 100 (checked in budget.test.ts)
 *   + 1 instanced mesh for all console lamps
 *   + 1 for all beacon domes, 2 for all sliding door leaves
 *   + 1 per particle emitter (sparks, dust) while a room is building
 *
 * against LAIR_DRAW_CALL_BUDGET (130). No real view shows all of that: a
 * room is dressed in one decor style and uses a third of the style pieces.
 * The debug scene's overview measures about 100 (it also draws the
 * restyled board, gong and clipboard Looks, plain meshes like the objects
 * they restyle). A richly furnished room with its door, lamps and corridor
 * junction needs about 50 (ROOM_DRAW_CALL_BUDGET 60), and further rooms add
 * almost nothing because they reuse the same instanced meshes, leaving most
 * of a ~250-draw frame for robots, laptop screens and boards. Lights: a
 * fixed pool of 6 tungsten point lights (LampLights) plus 2 red beacon
 * lights, never more, because changing the light count recompiles every
 * lit shader.
 *
 * Triangles. Each piece has a triangle budget in kit.ts (walls 100-260,
 * props 100-600, the console 900, build-phase stacks up to 1.5k); a 12 x 12
 * tile room shell plus a full set of furniture stays under
 * ROOM_TRIANGLE_BUDGET, so 20 robots and the visible rooms fit well inside
 * what an iGPU draws at 60 fps.
 */
import { pieceTriangles } from "./geometry/builder.ts";
import { PIECE_IDS, type PieceId, pieceGeometry } from "./kit.ts";
import { drawCalls, type PiecePlacement } from "./placements.ts";

/** Draws for every lair piece type on screen at once, plus the animated layers. */
export const LAIR_DRAW_CALL_BUDGET = 130;
/** Draws for one richly furnished room with its door, lamps and corridor junction. */
export const ROOM_DRAW_CALL_BUDGET = 60;
/** Triangles for the largest room (12 x 12 tiles) shell plus its furniture. */
export const ROOM_TRIANGLE_BUDGET = 80_000;
/** Real point lights the kit ever creates (lamp pool + beacon lights). */
export const LIGHT_BUDGET = 8;

/** Extra draws outside the per-piece instancing: lamps, beacon domes, door leaves (body + glow). */
export const ANIMATED_LAYER_DRAWS = 1 + 1 + 2;

export function hasGlow(id: PieceId): boolean {
  return pieceGeometry(id).glow !== undefined;
}

/** Draw calls if every piece type of the kit were on screen. */
export function kitDrawCalls(): number {
  return PIECE_IDS.reduce((n, id) => n + (hasGlow(id) ? 2 : 1), 0) + ANIMATED_LAYER_DRAWS;
}

export interface SceneCost {
  drawCalls: number;
  triangles: number;
  instances: number;
}

/** Cost of a set of placements under instanced rendering. */
export function sceneCost(items: readonly PiecePlacement[]): SceneCost {
  let triangles = 0;
  for (const p of items) triangles += pieceTriangles(pieceGeometry(p.piece));
  return { drawCalls: drawCalls(items, hasGlow), triangles, instances: items.length };
}
