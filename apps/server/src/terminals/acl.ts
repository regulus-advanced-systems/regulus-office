/**
 * Terminal ACL (SPEC §8 rule 4, §14 D12), checked on every connection:
 *
 * - Anyone who can view the robot's floor may watch its terminal.
 * - Control (typing, approving in the TUI, resizing) is the robot's owner's
 *   alone (#138); office `admin`s/`owner`s watch other people's robots like
 *   everyone else (their only lever is the FloorRoom `agent.emergencyStop`).
 * - `viewer`s watch only, even their own robots.
 *
 * "Can view the floor" is any access from floors/access.ts (owners/admins see
 * every live floor, others need a `floor_members` row, archived floors are
 * invisible), so the terminal and the FloorRoom agree on who sees a robot.
 */
import { mayControlRobot, type TerminalMode, type UserRole } from "@regulus/protocol";
import type { Db } from "../db/index.ts";
import { floorAccessFor } from "../floors/access.ts";

export interface TerminalUser {
  id: string;
  role: UserRole;
  /** Shown to the other viewers (faces, "X is typing"); the id is used when absent. */
  displayName?: string;
}

/** Whether `user` may see floor `floorId` at all. */
export type FloorVisibility = (user: TerminalUser, floorId: string) => boolean;

export type TerminalDecision =
  | { ok: true }
  /** `not_found`: the floor is invisible to the user, so the robot's existence is not revealed. */
  | { ok: false; reason: "not_found" | "forbidden" };

/** Whether `user` may take `mode` on a robot owned by `ownerUserId` on a floor they can see. */
export function mayUseTerminal(
  user: TerminalUser,
  ownerUserId: string,
  mode: TerminalMode,
): boolean {
  if (mode === "watch") return true;
  return mayControlRobot(user, ownerUserId);
}

export function decideTerminalAccess(
  user: TerminalUser,
  target: { ownerUserId: string; floorId: string },
  mode: TerminalMode,
  canViewFloor: FloorVisibility,
): TerminalDecision {
  if (!canViewFloor(user, target.floorId)) return { ok: false, reason: "not_found" };
  return mayUseTerminal(user, target.ownerUserId, mode)
    ? { ok: true }
    : { ok: false, reason: "forbidden" };
}

/** Floor visibility from `floors` + `floor_members` via floors/access.ts. */
export function dbFloorVisibility(db: Db): FloorVisibility {
  return (user, floorId) => floorAccessFor(db, user, floorId) !== null;
}
