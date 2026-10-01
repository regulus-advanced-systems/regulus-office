/**
 * Pure helpers for the floor settings panel (SPEC §5 `floor_members`, §11):
 * which overlay is open for which floor, who may open it, access wording and
 * the "Add people" candidate list. The server enforces every rule; these only
 * hide what it would refuse.
 */
import type {
  FloorAccess,
  FloorInfo,
  FloorMemberInfo,
  OfficeUserInfo,
  UserRole,
} from "@regulus/protocol";

const OVERLAY_PREFIX = "floor-settings:";

/** Overlay id of the settings panel for one floor (the UI store keeps one overlay at a time). */
export const floorSettingsOverlay = (floorId: string): string => `${OVERLAY_PREFIX}${floorId}`;

/** The floor whose settings panel `overlay` is, or null. */
export function floorIdFromOverlay(overlay: string | null): string | null {
  return overlay?.startsWith(OVERLAY_PREFIX) ? overlay.slice(OVERLAY_PREFIX.length) || null : null;
}

/** True when the REST list says the signed-in user may manage `floorId`. */
export function canManageFloor(
  floors: readonly FloorInfo[] | null,
  floorId: string | null | undefined,
): boolean {
  if (!floorId) return false;
  return floors?.some((f) => f.floorId === floorId && f.access === "manage") ?? false;
}

/** Least to most, as the selects list them. */
export const ACCESS_ORDER: readonly FloorAccess[] = ["view", "spawn", "manage"];

export const ACCESS_LABELS: Record<FloorAccess, string> = {
  view: "View",
  spawn: "Spawn henchmen",
  manage: "Manage",
};

export const ACCESS_HINT =
  "View: walk into the room and watch. Spawn henchmen: also put henchmen to work. Manage: also add and remove people.";

/** Owners and admins manage every floor already; granting them anything is a no-op. */
export const isOfficeManagerRole = (role: UserRole): boolean =>
  role === "owner" || role === "admin";

/** Office viewers are capped at `view` by the server whatever is stored. */
export function effectiveGrant(role: UserRole | undefined, access: FloorAccess): FloorAccess {
  return role === "viewer" ? "view" : access;
}

/**
 * People who could be added: not yet members, not owners/admins, whose
 * display name matches `query` (case-insensitive, anywhere in the name).
 */
export function addCandidates(
  people: readonly OfficeUserInfo[],
  members: readonly FloorMemberInfo[],
  query: string,
): OfficeUserInfo[] {
  const taken = new Set(members.map((m) => m.userId));
  const q = query.trim().toLocaleLowerCase();
  return people.filter(
    (p) =>
      !taken.has(p.userId) &&
      !isOfficeManagerRole(p.role) &&
      (q === "" || p.displayName.toLocaleLowerCase().includes(q)),
  );
}
