/**
 * Sit anchors of the lair chairs (#183) a generated room's seats are drawn
 * with (#186), so seated robots and humans sit on the cushions the scene
 * shows, not on the old Kenney chairs' measurements.
 */
import type { RoomTemplate, SeatKind } from "@regulus/room-layout";
import type { SitAnchor } from "../avatar/seatedFit.ts";
import { LAIR_MODELS, LAIR_SEAT_MODELS, lairSitAnchor } from "../lair/models.ts";

const FALLBACK: SitAnchor = { seatY: 0.33, backFwd: -0.15 };

const cache = new WeakMap<RoomTemplate, ReadonlyMap<string, SitAnchor>>();

export function lairAnchors(template: RoomTemplate): ReadonlyMap<string, SitAnchor> {
  const hit = cache.get(template);
  if (hit) return hit;
  const armchair = lairSitAnchor(LAIR_MODELS.armchair) ?? FALLBACK;
  const of = (kind: SeatKind) => {
    const model = LAIR_SEAT_MODELS[kind];
    return model ? (lairSitAnchor(model) ?? FALLBACK) : armchair;
  };
  const anchors = new Map(template.seats.map((s) => [s.id, of(s.kind)]));
  cache.set(template, anchors);
  return anchors;
}
