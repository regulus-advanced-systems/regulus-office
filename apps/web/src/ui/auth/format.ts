/** Display helpers for roles and invite expiry. */
import type { UserRole } from "@regulus/protocol";

const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  owner: "an owner",
  admin: "an admin",
  member: "a member",
  viewer: "a viewer",
};

const ROLE_HINTS: Readonly<Record<UserRole, string>> = {
  owner: "Full control, including other owners.",
  admin: "Manages people, operations and invites.",
  member: "Spawns and drives their own henchmen; watches everyone's.",
  viewer: "Can look around and watch terminals only.",
};

/** "an admin", "a member", … for sentences. */
export const roleLabel = (role: UserRole): string => ROLE_LABELS[role];
export const roleHint = (role: UserRole): string => ROLE_HINTS[role];
export const roleName = (role: UserRole): string => role.charAt(0).toUpperCase() + role.slice(1);

/** Absolute date and time in the viewer's locale, e.g. "5 Oct 2026, 14:03". */
export function formatExpiry(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an unknown date";
  return d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** "in 7 days", "in 3 hours", "in 5 minutes", "expired". */
export function expiresIn(iso: string, now: number = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${Math.max(1, minutes)} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(ms / 86_400_000);
  return `in ${days} days`;
}
