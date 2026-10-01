/**
 * Henchmen (#184) in the debug scene, so the owner sees the characters and
 * the lair together: seated at the main room's desks (placed with the lair
 * chair's sit anchor and the henchman's seated body), operators at the
 * consoles, one walking up the corridor, builders on the site, and the
 * gallery rooms staffed in their style's skin. Debug only.
 */
import type { RoomLayout, Seat } from "@regulus/floor-layout";
import type { AgentStatus, AvatarAnimation } from "@regulus/protocol";
import { providerLightColor } from "../../avatar/colorSets.ts";
import { seatedOffset } from "../../avatar/seatedFit.ts";
import { HenchmanAvatar } from "../../henchmen/HenchmanAvatar.tsx";
import { HENCHMAN_SEATED_BODY } from "../../henchmen/seatedFit.ts";
import { resolveModelId } from "../generatorModels.ts";
import { LAIR_CHAIR, lairSitAnchor } from "../models.ts";

export interface HenchmanSpot {
  key: string;
  position: readonly [number, number, number];
  heading: number;
  animation: AvatarAnimation;
  status: AgentStatus;
  seated?: boolean;
  handRaised?: boolean;
  skin?: string;
  trim?: string;
}

const CLAUDE = providerLightColor("claude-code");
const CODEX = providerLightColor("codex");

/** Where a henchman sits on a seat's lair chair (pure). */
export function seatedSpot(
  layout: RoomLayout,
  seat: Seat,
  offset: readonly [number, number] = [0, 0],
) {
  const id = layout.room.models[seat.id];
  const binding = id ? resolveModelId(id) : undefined;
  const model = binding && "model" in binding ? binding.model : LAIR_CHAIR;
  const anchor = lairSitAnchor(model) ?? { seatY: 0.33, backFwd: -0.15 };
  const o = seatedOffset(anchor, HENCHMAN_SEATED_BODY);
  const h = seat.pose.heading;
  return {
    position: [
      seat.pose.x - Math.sin(h) * o.forward + offset[0],
      o.lift,
      seat.pose.z - Math.cos(h) * o.forward + offset[1],
    ] as const,
    heading: h,
  };
}

/** Henchmen for a room: every other desk seat taken, one asking for permission. */
export function roomCrew(
  layout: RoomLayout,
  prefix: string,
  skin?: string,
  offset?: readonly [number, number],
): HenchmanSpot[] {
  const seats = layout.seats.filter((s) => s.kind === "desk");
  return seats
    .filter((_, i) => i % 2 === 0 || i === 3)
    .map((seat, i) => ({
      key: `${prefix}-${seat.id}`,
      ...seatedSpot(layout, seat, offset),
      animation: i === 2 ? "sit_idle" : "sit_type",
      status: i === 2 ? "waiting_permission" : "working",
      seated: true,
      handRaised: i === 2,
      skin,
      trim: i % 2 ? CODEX : CLAUDE,
    }));
}

/** The set-piece henchmen: console operators, a corridor walker and the builders. */
export function extraCrew(
  corridorCentreX: number,
  corridorZ: number,
  site: { x: number; z: number },
): HenchmanSpot[] {
  return [
    {
      key: "op-1",
      position: [11.0, 0, 1.75],
      heading: 0,
      animation: "point",
      status: "working",
      trim: CLAUDE,
    },
    {
      key: "op-2",
      position: [13.1, 0, 1.8],
      heading: 0.2,
      animation: "think",
      status: "idle",
      trim: CODEX,
    },
    {
      key: "walker",
      position: [corridorCentreX + 0.6, 0, corridorZ + 5],
      heading: 0,
      animation: "walk",
      status: "idle",
      trim: CLAUDE,
    },
    {
      key: "builder-1",
      position: [site.x + 5.2, 0, site.z + 3.4],
      heading: -2.2,
      animation: "point",
      status: "working",
      trim: CODEX,
    },
    {
      key: "builder-2",
      position: [site.x + 2.6, 0, site.z + 5.2],
      heading: 0.9,
      animation: "wave",
      status: "working",
      trim: CLAUDE,
    },
  ];
}

export function DebugHenchmen({ spots }: { spots: readonly HenchmanSpot[] }) {
  return (
    <group name="lair:henchmen">
      {spots.map((s) => (
        <HenchmanAvatar
          key={s.key}
          position={s.position}
          rotation-y={s.heading}
          animation={s.animation}
          status={s.status}
          seated={s.seated}
          handRaised={s.handRaised}
          skin={s.skin}
          trim={s.trim}
        />
      ))}
    </group>
  );
}
