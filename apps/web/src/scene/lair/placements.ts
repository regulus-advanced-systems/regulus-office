/**
 * Piece placements (#183): where a piece instance goes. Pure data and maths,
 * shared by the instanced renderer, the corridor and room assemblers and
 * the draw-call accounting in budget.ts.
 */
import { Color, Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { Vec3 } from "./geometry/builder.ts";
import { PIECES, type PieceId } from "./kit.ts";

export interface PiecePlacement {
  piece: PieceId;
  position: Vec3;
  /** Yaw, radians (three.js rotation.y; 0 keeps the piece's front toward +z). */
  rotationY?: number;
  scale?: Vec3;
  /** Multiplies the vertex colours (barrel paint, decor-style tints). */
  tint?: string;
  /** Piece-local offset applied before scale and rotation (centre a piece's bounds on its spot). */
  pivot?: Vec3;
}

const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpP = new Vector3();
const tmpS = new Vector3();
const tmpM = new Matrix4();

/** The instance matrix of a placement, optionally inside a parent transform. */
export function placementMatrix(p: PiecePlacement, out = new Matrix4(), parent?: Matrix4): Matrix4 {
  tmpE.set(0, p.rotationY ?? 0, 0);
  tmpQ.setFromEuler(tmpE);
  tmpP.set(p.position[0], p.position[1], p.position[2]);
  tmpS.set(p.scale?.[0] ?? 1, p.scale?.[1] ?? 1, p.scale?.[2] ?? 1);
  out.compose(tmpP, tmpQ, tmpS);
  if (p.pivot) out.multiply(tmpM.makeTranslation(p.pivot[0], p.pivot[1], p.pivot[2]));
  if (parent) out.premultiply(parent);
  return out;
}

/** Placements grouped by piece, in first-seen order (one instanced mesh per group). */
export function groupByPiece(items: readonly PiecePlacement[]): Map<PieceId, PiecePlacement[]> {
  const out = new Map<PieceId, PiecePlacement[]>();
  for (const item of items) {
    const list = out.get(item.piece);
    if (list) list.push(item);
    else out.set(item.piece, [item]);
  }
  return out;
}

/** Instance colours for a group, or null when no placement is tinted (no attribute needed). */
export function instanceTints(items: readonly PiecePlacement[]): Float32Array | null {
  if (!items.some((i) => i.tint)) return null;
  const out = new Float32Array(items.length * 3);
  const c = new Color();
  items.forEach((item, i) => {
    c.set(item.tint ?? "#FFFFFF");
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  });
  return out;
}

/** Move placements into a parent frame: rotate by `yaw` about the origin, then translate. */
export function transformPlacements(
  items: readonly PiecePlacement[],
  offset: Vec3,
  yaw = 0,
): PiecePlacement[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return items.map((p) => ({
    ...p,
    // three's rotation.y: x' = x cos + z sin, z' = -x sin + z cos.
    position: [
      offset[0] + p.position[0] * c + p.position[2] * s,
      offset[1] + p.position[1],
      offset[2] - p.position[0] * s + p.position[2] * c,
    ] as const,
    rotationY: (p.rotationY ?? 0) + yaw,
  }));
}

/**
 * Draw calls the instanced renderer issues for a set of placements: one per
 * piece type, plus one more for types that have a glow layer.
 */
export function drawCalls(
  items: readonly PiecePlacement[],
  glowOf: (id: PieceId) => boolean,
): number {
  let n = 0;
  for (const id of groupByPiece(items).keys()) n += glowOf(id) ? 2 : 1;
  return n;
}

/** Whether a piece is cut away with the walls. */
export function isCutaway(id: PieceId): boolean {
  return PIECES[id].cutaway === true;
}
