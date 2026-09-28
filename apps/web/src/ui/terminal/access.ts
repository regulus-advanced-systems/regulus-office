/**
 * Client mirror of the terminal ACL (SPEC §14 D12, server `terminals/acl.ts`):
 * the owner of the robot or an office owner/admin may control, members watch,
 * viewers watch only. Only decides which buttons to show; the server checks
 * every connection and wins (a refused control attach falls back to watch).
 */
import type { UserRole } from "@regulus/protocol/src/enums.ts";

export interface TerminalViewerIdentity {
  id: string;
  role: UserRole;
}

export function mayControlTerminal(
  user: TerminalViewerIdentity | null | undefined,
  robotOwnerUserId: string | undefined,
): boolean {
  if (!user) return false;
  if (user.role === "owner" || user.role === "admin") return true;
  if (user.role === "viewer") return false;
  return robotOwnerUserId !== undefined && user.id === robotOwnerUserId;
}
