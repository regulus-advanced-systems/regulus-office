/**
 * Where a seated human goes (#49): on the sit anchor of the model the seat
 * is drawn with (the lair sofa, lounge chair or chair, #183), like a seated
 * henchman (henchmanPlacement), in compound metres.
 */
import type { SitAnchor } from "../avatar/seatedFit.ts";
import { lairAnchors } from "../compound/lairAnchors.ts";
import { roomLayout } from "../compound/layouts.ts";
import { type HenchmanPlacement, henchmanPlacement } from "../henchmen/seatPlacement.ts";
import { isLairModelId, LAIR_CHAIR, LAIR_MODELS, lairSitAnchor } from "../lair/models.ts";
import type { HumanSeat } from "./seats.ts";

/** The sit anchor of a seat: its room's lair anchor, or the special room model's. */
export function seatAnchor(s: HumanSeat): SitAnchor | undefined {
  if (s.room.kind === "project") {
    const layout = roomLayout(s.room);
    return layout ? lairAnchors(layout).get(s.seat.id) : undefined;
  }
  const model = s.seat.furnitureId;
  const lair = model && isLairModelId(model) ? LAIR_MODELS[model] : undefined;
  return (lair && lairSitAnchor(lair)) ?? lairSitAnchor(LAIR_CHAIR);
}

/** The seated avatar's position and turn, compound metres. */
export function seatedPlacement(s: HumanSeat): HenchmanPlacement {
  const place = henchmanPlacement(s.seat, true, seatAnchor(s));
  const [x, y, z] = place.position;
  return { position: [x + s.room.origin.x, y, z + s.room.origin.z], rotationY: place.rotationY };
}
