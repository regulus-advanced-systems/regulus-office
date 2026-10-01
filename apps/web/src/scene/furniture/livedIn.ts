/**
 * Pure layout maths for the "lived-in" props (#118 review): books on a
 * bookshelf, plants in a planter, props on furniture, wall decor pieces.
 * The components in `LivedIn.tsx` / `WallDecor.tsx` only draw the results.
 */
import type { Decor, RoomTemplate, ObstacleKind, Rect } from "@regulus/room-layout";
import { FURNITURE_MODELS, PLACEHOLDER_HEIGHTS } from "./catalog.ts";

/** Warm, muted spine colours for procedural books. */
export const BOOK_COLORS = ["#B83159", "#1E6FE0", "#F5A623", "#2E9E3E", "#6B6580", "#F26522"];

export interface BookBox {
  /** Offset from the shelf's centre-bottom, along its width (x) and height (y). */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly color: string;
}

/**
 * Books standing on each shelf of a bookshelf `width` wide with `shelves`
 * boards over `height`: runs of books with gaps, deterministic (no random).
 */
export function shelfBooks(width: number, height: number, shelves = 4): BookBox[] {
  const out: BookBox[] = [];
  const gap = height / shelves;
  for (let s = 0; s < shelves; s++) {
    let x = -width / 2 + 0.06;
    let i = s * 3;
    // Leave the right third of every other shelf empty so it does not look packed.
    const end = width / 2 - (s % 2 === 0 ? width / 3 : 0.06);
    while (x < end - 0.05) {
      const w = 0.04 + ((i * 7) % 4) * 0.01;
      const h = gap * (0.55 + ((i * 5) % 4) * 0.08);
      out.push({
        x: x + w / 2,
        y: s * gap + 0.03,
        w,
        h,
        color: BOOK_COLORS[i % BOOK_COLORS.length] as string,
      });
      x += w + 0.005;
      i++;
    }
  }
  return out;
}

/** Rects for the small plants growing in a planter box, spaced along its long side. */
export function planterPlants(rect: Rect, spacing = 0.6): Rect[] {
  const alongX = rect.w >= rect.d;
  const length = alongX ? rect.w : rect.d;
  const n = Math.max(1, Math.floor(length / spacing));
  const size = Math.min(alongX ? rect.d : rect.w, spacing) * 0.8;
  const out: Rect[] = [];
  for (let k = 0; k < n; k++) {
    const t = ((k + 0.5) / n) * length;
    const cx = alongX ? rect.x + t : rect.x + rect.w / 2;
    const cz = alongX ? rect.z + rect.d / 2 : rect.z + t;
    out.push({ x: cx - size / 2, z: cz - size / 2, w: size, d: size });
  }
  return out;
}

/** Top-surface height of an obstacle kind (what a prop on it stands on). */
export function surfaceHeight(kind: ObstacleKind): number {
  return FURNITURE_MODELS[kind]?.targetHeight ?? PLACEHOLDER_HEIGHTS[kind];
}

export interface PropPlacement {
  readonly decor: Decor;
  readonly position: readonly [number, number, number];
}

/** Every prop placed on top of the obstacle it names. */
export function propPlacements(template: RoomTemplate): PropPlacement[] {
  const out: PropPlacement[] = [];
  for (const decor of template.decor) {
    const base = template.obstacles.find((o) => o.id === decor.on);
    if (!base) continue;
    out.push({ decor, position: [decor.x, surfaceHeight(base.kind), decor.z] });
  }
  return out;
}
