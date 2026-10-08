/**
 * The people in the lair as the agents' bodies need them (#252, #60): where
 * each person is, which levels somebody is on, and where a henchman's owner
 * is while an agent stands next to that henchman. Pure.
 */
import type { BuildingStateSchema } from "@regulus/protocol";
import type { Pose } from "@regulus/room-layout";
import { type Lair, roomAt } from "./geometry.ts";
import type { OwnerWhereabouts } from "./types.ts";

type State = InstanceType<typeof BuildingStateSchema>;

export interface Owner extends Pose {
  levelId: string;
  joinedAt: number;
}

export interface People {
  /** By user id. Someone connected twice is where they joined last. */
  owners: Map<string, Owner>;
  /** Levels somebody is on. */
  populated: Set<string>;
}

export function readPeople(state: Pick<State, "humans">): People {
  const owners = new Map<string, Owner>();
  const populated = new Set<string>();
  state.humans.forEach((h) => {
    populated.add(h.levelId);
    const seen = owners.get(h.userId);
    if (seen && seen.joinedAt > h.joinedAt) return;
    owners.set(h.userId, {
      x: h.position.x,
      z: h.position.z,
      heading: h.position.heading,
      levelId: h.levelId,
      joinedAt: h.joinedAt,
    });
  });
  return { owners, populated };
}

/** Where a henchman's owner is while an agent's body stands next to it in `operationId`. */
export function whereabouts(
  lair: Lair,
  at: { levelId: string; operationId: string },
  owner: Owner | undefined,
): OwnerWhereabouts {
  if (!owner) return "away";
  if (owner.levelId !== at.levelId) return "elsewhere";
  const room = roomAt(lair.levels.get(owner.levelId), owner);
  return room?.kind === "project" && room.id === at.operationId ? "in_the_room" : "elsewhere";
}
