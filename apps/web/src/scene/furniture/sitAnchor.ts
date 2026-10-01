/**
 * Sit anchors (#163): where a sitter's body goes on each seat, from the
 * model the seat is drawn with. A desk, meeting, bistro or reception seat is
 * a desk chair centred on the seat point (pulled out when its table stands
 * too close for the henchman); a lounge seat (`couch` kind) is a cushion of its
 * armchair or couch. The model's `SitSpec` (catalog.ts) says
 * where its cushion top and backrest are as fractions of its bounds; this
 * file runs them through the same `fitToFootprint` placement the scene draws
 * the model with, so the anchor follows any scale or turn. Pure maths.
 */
import type { Rect, RoomTemplate, Seat } from "@regulus/room-layout";
import { SEATED_REACH, type SitAnchor, TABLE_GAP } from "../avatar/seatedFit.ts";
import { facing, rayEntry } from "../laptops/placement.ts";
import { CHAIR_MODEL, chairForSeat, FURNITURE_MODELS, type ModelSpec } from "./catalog.ts";
import { fitToFootprint, furnitureHeading, SEAT_FOOTPRINT, visualFootprint } from "./placement.ts";

export type { SitAnchor };

/** The model a seat is drawn with, and the footprint and heading it is placed at. */
export interface SeatModel {
  spec: ModelSpec;
  rect: Rect;
  heading: number;
}

/**
 * The footprint of the chair drawn at a chair seat: a square centred on the
 * seat point, or `setBack` metres behind it (pulled out from the table).
 */
export function chairRect(pose: Seat["pose"], setBack = 0): Rect {
  const half = SEAT_FOOTPRINT / 2;
  const x = pose.x + Math.sin(pose.heading) * setBack;
  const z = pose.z + Math.cos(pose.heading) * setBack;
  return { x: x - half, z: z - half, w: SEAT_FOOTPRINT, d: SEAT_FOOTPRINT };
}

/** Distance from a seat point to the edge of its table, straight ahead; null without one. */
export function tableDistance(template: RoomTemplate, seat: Seat): number | null {
  const table = template.obstacles.find((o) => o.id === seat.furnitureId);
  return table ? rayEntry(seat.pose, facing(seat.pose.heading), table.rect) : null;
}

/**
 * How far to pull a chair back from its seat point so a seated henchman fits
 * between the backrest and the table (#163): the meeting chairs stand 0.25 m
 * from the table's edge, and the henchman needs 0.51 m ahead of the backrest.
 */
export function chairSetBack(template: RoomTemplate, seat: Seat, spec: ModelSpec): number {
  const edge = tableDistance(template, seat);
  if (edge === null) return 0;
  const centred = modelAnchor(
    { spec, rect: chairRect(seat.pose), heading: seat.pose.heading },
    seat.pose,
  );
  if (!centred) return 0;
  return Math.max(0, centred.backFwd + SEATED_REACH + TABLE_GAP - edge);
}

/** Which model carries a seat, placed the way `Furniture.tsx` places it; null if none is drawn. */
export function seatModel(template: RoomTemplate, seat: Seat): SeatModel | null {
  const chair = chairForSeat(seat.kind);
  if (chair) {
    const rect = chairRect(seat.pose, chairSetBack(template, seat, chair));
    return { spec: chair, rect, heading: seat.pose.heading };
  }
  const piece = template.obstacles.find((o) => o.id === seat.furnitureId);
  const spec = piece ? FURNITURE_MODELS[piece.kind] : undefined;
  if (!piece || !spec) return null;
  return {
    spec,
    rect: visualFootprint(piece, template.seats),
    heading: furnitureHeading(piece, template.seats, template.size),
  };
}

/** Scale and turn of a seat model with sit data, as `GltfProp` draws it. */
function placedSit(model: SeatModel) {
  const sit = model.spec.sit;
  if (!sit) return null;
  const p = fitToFootprint(sit.size, model.rect, model.heading, {
    targetHeight: model.spec.targetHeight,
    uniform: model.spec.uniform,
    modelHeading: model.spec.modelHeading,
  });
  return { sit, p };
}

/** Cushion top and backrest front of a placed model, relative to a seat pose; null without sit data. */
export function modelAnchor(model: SeatModel, pose: Seat["pose"]): SitAnchor | null {
  const placed = placedSit(model);
  if (!placed) return null;
  const { sit, p } = placed;
  const [, sy, sz] = p.scale;
  // The backrest's front in the centred model (its back is at -d/2), scaled and turned.
  const back = (sit.backFront - 0.5) * sit.size.d * sz;
  const bx = p.position[0] + back * Math.sin(p.rotationY);
  const bz = p.position[2] + back * Math.cos(p.rotationY);
  const fx = -Math.sin(pose.heading);
  const fz = -Math.cos(pose.heading);
  return {
    seatY: sit.seatTop * sit.size.h * sy,
    backFwd: (bx - pose.x) * fx + (bz - pose.z) * fz,
  };
}

/** Top of the backrest above the floor for a placed model with sit data, else 0. */
export function backTopY(model: SeatModel): number {
  const placed = placedSit(model);
  return placed ? placed.sit.backTop * placed.sit.size.h * placed.p.scale[1] : 0;
}

/** A seat drawn without a measured model: the desk chair's anchor. */
export const FALLBACK_ANCHOR: SitAnchor = modelAnchor(
  { spec: CHAIR_MODEL, rect: chairRect({ x: 0, z: 0, heading: 0 }), heading: 0 },
  { x: 0, z: 0, heading: 0 },
) ?? { seatY: 0.31, backFwd: -0.13 };

/** Where a sitter goes on this seat. */
export function sitAnchor(template: RoomTemplate, seat: Seat): SitAnchor {
  const model = seatModel(template, seat);
  return (model && modelAnchor(model, seat.pose)) ?? FALLBACK_ANCHOR;
}

const anchorCache = new WeakMap<RoomTemplate, ReadonlyMap<string, SitAnchor>>();

/** Every seat's anchor by seat id, computed once per template. */
export function sitAnchors(template: RoomTemplate): ReadonlyMap<string, SitAnchor> {
  let anchors = anchorCache.get(template);
  if (!anchors) {
    anchors = new Map(template.seats.map((s) => [s.id, sitAnchor(template, s)]));
    anchorCache.set(template, anchors);
  }
  return anchors;
}
