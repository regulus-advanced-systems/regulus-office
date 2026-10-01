/**
 * Client mirror of the terminal ACL (SPEC §14 D12, server `terminals/acl.ts`,
 * #138): only the henchman's owner may control; everyone else, office
 * owners/admins included, watches; viewers watch only, even their own henchmen.
 * Only decides which buttons to show; the server checks every connection and
 * wins (a refused control attach falls back to watch).
 */
import { mayControlHenchman } from "@regulus/protocol/src/acl.ts";
import type { UserRole } from "@regulus/protocol/src/enums.ts";

export interface TerminalViewerIdentity {
  id: string;
  role: UserRole;
}

export function mayControlTerminal(
  user: TerminalViewerIdentity | null | undefined,
  henchmanOwnerUserId: string | undefined,
): boolean {
  return mayControlHenchman(user, henchmanOwnerUserId);
}
