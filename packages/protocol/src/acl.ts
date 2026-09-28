/**
 * Who may control a robot (SPEC §8 rule 4, §14 D12): its owner or an office
 * `owner`/`admin`; `viewer`s never, not even their own robots. Control means
 * typing into its terminal, prompting, approving, stopping, resuming, sending
 * it home and opening its PR. Everyone who can see the floor may watch.
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
  if (user.role === "owner" || user.role === "admin") return true;
  if (user.role === "viewer") return false;
  return robotOwnerUserId !== undefined && robotOwnerUserId !== "" && user.id === robotOwnerUserId;
}
