/**
 * Home posts (#60, #56): where an agent with a post stands. The office PM has
 * the reception desk; a board helper has the board it was placed at, in its
 * project room, where it stands beside the board (not in front of it, where
 * the person using the board stands) and faces the room. Pure.
 */
import { KIOSK_BOARD_LABELS, kioskBoardOfPost, LOBBY_OPERATION_ID } from "@regulus/protocol";
import { anchorStandPose, projectRoomLayout, wallById } from "@regulus/room-layout";
import { clampInto, type Lair, type LairRoom } from "./geometry.ts";
import { receptionPost } from "./rounds.ts";
import type { Spot } from "./spots.ts";
import type { WorldAgent } from "./types.ts";

/** How far off the wall a board helper stands, metres (a person at the board stands 0.75 off). */
export const KIOSK_OFF_WALL = 0.55;

/**
 * Along the wall from the board's centre, past its edge by this much, metres.
 * The boards hang side by side (issues, pull requests, queue), so each helper
 * gets its own side: the issue helper outside the first board, the others
 * after theirs.
 */
const SIDE: Readonly<Record<string, (w: number) => number>> = {
  issue_board: (w) => -(w / 2 + 0.1),
  pr_board: (w) => w / 2 - 0.15,
  queue_clipboard: (w) => w / 2 + 0.5,
};

export const isBoardPost = (post: WorldAgent["post"]): boolean =>
  kioskBoardOfPost(post) !== undefined;

/** The project room with this operation id, wherever it is in the lair. */
function projectRoom(lair: Lair, operationId: string): LairRoom | null {
  for (const level of lair.levels.values()) {
    const room = level.rooms.find((r) => r.kind === "project" && r.id === operationId);
    if (room) return room;
  }
  return null;
}

/**
 * Where a board helper stands; null while its room is not there, is still
 * being built, or has no such board.
 */
export function boardPost(lair: Lair, agent: Pick<WorldAgent, "post" | "postRoom">): Spot | null {
  const board = kioskBoardOfPost(agent.post);
  const room = board && agent.postRoom ? projectRoom(lair, agent.postRoom) : null;
  if (!board || !room?.ready) return null;
  const layout = projectRoomLayout({
    width: room.tiles.w,
    depth: room.tiles.d,
    doorSide: room.doorSide,
    deskCount: room.deskCount,
    decorStyle: room.decorStyle,
  });
  const anchor = layout?.wallAnchors.find((a) => a.kind === agent.post);
  const wall = layout && anchor ? wallById(layout, anchor.wallId) : undefined;
  if (!anchor || !wall) return null;
  const side = SIDE[anchor.kind]?.(anchor.w) ?? 0;
  const local = anchorStandPose(wall, { ...anchor, t: anchor.t + side, approach: KIOSK_OFF_WALL });
  const p = clampInto(room.rect, { x: room.rect.x + local.x, z: room.rect.z + local.z }, 0.5);
  return {
    x: p.x,
    z: p.z,
    // Its back to the wall.
    heading: local.heading + Math.PI,
    levelId: room.levelId,
    operationId: room.id,
    place: room.id,
    doing: `at the ${KIOSK_BOARD_LABELS[board].toLowerCase()}`,
  };
}

/** The post of an agent that has one, as a spot; null for an agent without, or whose post is not there. */
export function postOf(lair: Lair, agent: WorldAgent): Spot | null {
  if (agent.post === "reception") {
    const post = receptionPost(lair);
    return post ? { ...post, place: LOBBY_OPERATION_ID, doing: "at reception" } : null;
  }
  return boardPost(lair, agent);
}
