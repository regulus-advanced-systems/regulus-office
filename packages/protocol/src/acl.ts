/**
 * Who may control a robot (SPEC §8 rule 4, §14 D12; issue #138): only its
 * owner, and never a `viewer`, not even for their own robots. Control means
 * typing into its terminal, prompting, approving, interrupting, stopping,
 * resuming, sending it home, reading its worktree and opening its PR.
 * Everyone who can see the floor may watch.
 *
 * Office `owner`s and `admin`s do not control other people's robots. They
 * keep one audited escape hatch: `agent.emergencyStop` kills the session and
 * keeps the branch (runaway cost, a robot doing damage while its owner is
 * away). Nothing else: no typing, no approving, no prompting.
 *
 * No zod here, so the web bundle can import it on its own.
 */
import type { UserRole } from "./enums.ts";

export interface RobotController {
  id: string;
  role: UserRole;
}

export function mayControlRobot(
  user: RobotController | null | undefined,
  robotOwnerUserId: string | undefined,
): boolean {
  if (!user) return false;
  if (user.role === "viewer") return false;
  return robotOwnerUserId !== undefined && robotOwnerUserId !== "" && user.id === robotOwnerUserId;
}

/**
 * Whether `user` may emergency-stop a robot they do not control: office
 * `owner`s and `admin`s only. The robot's owner uses the ordinary stop.
 */
export function mayEmergencyStop(user: RobotController | null | undefined): boolean {
  return user?.role === "owner" || user?.role === "admin";
}
