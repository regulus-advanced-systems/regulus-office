/**
 * Pure helpers for the operation settings panel (SPEC §5 `operation_members`, §11):
 * which overlay is open for which operation, who may open it, access wording and
 * the "Add people" candidate list. The server enforces every rule; these only
 * hide what it would refuse.
 */
import type {
  OfficeUserInfo,
  OperationAccess,
  OperationInfo,
  OperationMemberInfo,
  UserRole,
} from "@regulus/protocol";

const OVERLAY_PREFIX = "operation-settings:";

/** Overlay id of the settings panel for one operation (the UI store keeps one overlay at a time). */
export const operationSettingsOverlay = (operationId: string): string =>
  `${OVERLAY_PREFIX}${operationId}`;

/** The operation whose settings panel `overlay` is, or null. */
export function operationIdFromOverlay(overlay: string | null): string | null {
  return overlay?.startsWith(OVERLAY_PREFIX) ? overlay.slice(OVERLAY_PREFIX.length) || null : null;
}

/** True when the REST list says the signed-in user may manage `operationId`. */
export function canManageOperation(
  operations: readonly OperationInfo[] | null,
  operationId: string | null | undefined,
): boolean {
  if (!operationId) return false;
  return operations?.some((f) => f.operationId === operationId && f.access === "manage") ?? false;
}

/** Least to most, as the selects list them. */
export const ACCESS_ORDER: readonly OperationAccess[] = ["view", "spawn", "manage"];

export const ACCESS_LABELS: Record<OperationAccess, string> = {
  view: "View",
  spawn: "Spawn henchmen",
  manage: "Manage",
};

export const ACCESS_HINT =
  "View: walk into the room and watch. Spawn henchmen: also put henchmen to work. Manage: also change the room and these limits.";

/** Office owners and admins: they run the office; rooms open for them like for anyone (D27). */
export const isOfficeManagerRole = (role: UserRole): boolean =>
  role === "owner" || role === "admin";

/** Office viewers are capped at `view` by the server whatever is stored. */
export function effectiveGrant(
  role: UserRole | undefined,
  access: OperationAccess,
): OperationAccess {
  return role === "viewer" ? "view" : access;
}

/**
 * People who could be limited: no limit yet, whose display name matches
 * `query` (case-insensitive, anywhere in the name). Owners and admins too:
 * their role gives them no room (D27; #270).
 */
export function addCandidates(
  people: readonly OfficeUserInfo[],
  members: readonly OperationMemberInfo[],
  query: string,
): OfficeUserInfo[] {
  const taken = new Set(members.map((m) => m.userId));
  const q = query.trim().toLocaleLowerCase();
  return people.filter(
    (p) => !taken.has(p.userId) && (q === "" || p.displayName.toLocaleLowerCase().includes(q)),
  );
}
