/**
 * Who may control a henchman (SPEC §8 rule 4, §14 D12; issue #138): only its
 * owner, and never a `viewer`, not even for their own henchmen. Control means
 * typing into its terminal, prompting, approving, interrupting, stopping,
 * resuming, sending it home, reading its worktree and opening its PR.
 * Everyone who can see the operation may watch.
 *
 * Office `owner`s and `admin`s do not control other people's henchmen. They
 * keep one audited escape hatch: `agent.emergencyStop` kills the session and
 * keeps the branch (runaway cost, a henchman doing damage while its owner is
 * away). Nothing else: no typing, no approving, no prompting.
 *
 * No zod here, so the web bundle can import it on its own.
 */
import type { UserRole } from "./enums.ts";

export interface HenchmanController {
  id: string;
  role: UserRole;
}

export function mayControlHenchman(
  user: HenchmanController | null | undefined,
  henchmanOwnerUserId: string | undefined,
): boolean {
  if (!user) return false;
  if (user.role === "viewer") return false;
  return (
    henchmanOwnerUserId !== undefined &&
    henchmanOwnerUserId !== "" &&
    user.id === henchmanOwnerUserId
  );
}

/**
 * Whether `user` may emergency-stop a henchman they do not control: office
 * `owner`s and `admin`s only. The henchman's owner uses the ordinary stop.
 */
export function mayEmergencyStop(user: HenchmanController | null | undefined): boolean {
  return user?.role === "owner" || user?.role === "admin";
}
