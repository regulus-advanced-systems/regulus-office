/**
 * Where each desk seat's laptop sits (SPEC §9.4): on the seat's own desk,
 * a little in from the edge nearest the chair, screen facing the chair.
 * Pure maths over the floor template; only `desk` seats get a laptop.
 */
import type { FloorTemplate, ObstacleKind, Rect, Seat } from "@regulus/floor-layout";
import { FURNITURE_MODELS, PLACEHOLDER_HEIGHTS } from "../furniture/catalog.ts";

export interface LaptopPlacement {
  seatId: string;
  /** Centre of the laptop base on the desk top, metres. */
  position: readonly [number, number, number];
  /** three.js rotation.y; the screen faces +z before rotation, i.e. back toward the chair. */
  rotationY: number;
}

/** Laptop footprint and how far in from the desk edge its centre sits. */
export const LAPTOP_SIZE = { w: 0.34, d: 0.24 } as const;
const EDGE_INSET = LAPTOP_SIZE.d / 2 + 0.08;
/** Used when a seat names no furniture. */
const FALLBACK_REACH = 0.7;
const DEFAULT_DESK_HEIGHT = 0.76;

/** Unit ground vector a heading faces (heading 0 faces -z). */
export function facing(heading: number): { x: number; z: number } {
  return { x: -Math.sin(heading), z: -Math.cos(heading) };
}

/** Distance along the ray from `from` in `dir` until it enters `rect`, or null if it misses. */
export function rayEntry(
  from: { x: number; z: number },
  dir: { x: number; z: number },
  rect: Rect,
): number | null {
  let t0 = 0;
  let t1 = Number.POSITIVE_INFINITY;
  const axes: [number, number, number, number][] = [
    [from.x, dir.x, rect.x, rect.x + rect.w],
    [from.z, dir.z, rect.z, rect.z + rect.d],
  ];
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return null;
      continue;
    }
    const a = (lo - p) / d;
    const b = (hi - p) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1 ? t0 : null;
}

function deskHeight(kind: ObstacleKind | undefined): number {
  if (!kind) return DEFAULT_DESK_HEIGHT;
  return FURNITURE_MODELS[kind]?.targetHeight ?? PLACEHOLDER_HEIGHTS[kind];
}

export function laptopPlacement(template: FloorTemplate, seat: Seat): LaptopPlacement {
  const dir = facing(seat.pose.heading);
  const desk = seat.furnitureId
    ? template.obstacles.find((o) => o.id === seat.furnitureId)
    : undefined;
  const entry = desk ? rayEntry(seat.pose, dir, desk.rect) : null;
  const reach = entry === null ? FALLBACK_REACH : entry + EDGE_INSET;
  return {
    seatId: seat.id,
    position: [seat.pose.x + dir.x * reach, deskHeight(desk?.kind), seat.pose.z + dir.z * reach],
    // A +z-facing model rotated by the seat heading faces opposite the seat: toward the chair.
    rotationY: seat.pose.heading,
  };
}

export function laptopPlacements(template: FloorTemplate): LaptopPlacement[] {
  return template.seats.filter((s) => s.kind === "desk").map((s) => laptopPlacement(template, s));
}
