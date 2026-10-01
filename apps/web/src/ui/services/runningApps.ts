/**
 * The Running apps list (SPEC §9.4, #39) from the FloorRoom state: every
 * service a robot on this floor serves, and whether this viewer may open it.
 * A client mirror of the server's app ACL (apps/server/src/services/access.ts);
 * the proxy checks every request and wins.
 *
 * - The robot's owner opens its apps (never a `viewer`, D12).
 * - Everyone else on the floor watches them read-only, when the office serves
 *   apps on their own origin (`shared`); otherwise only the owner may.
 * - A server bound to localhost inside the sandbox cannot be reached at all.
 */

import type { FloorState } from "@regulus/protocol";
import { mayControlRobot } from "@regulus/protocol/src/acl.ts";
import type { UserRole } from "@regulus/protocol/src/enums.ts";

export interface AppViewer {
  id: string;
  role: UserRole;
}

export type AppOpen = "control" | "watch" | "localhost" | "owner_only";

export interface AppRow {
  id: string;
  agentId: string;
  /** Whose robot, e.g. "Mia's robot". */
  robot: string;
  title: string;
  port: number;
  url: string;
  open: AppOpen;
}

export const LOCALHOST_HINT =
  "Listens on localhost only inside the henchman's sandbox. Restart it bound to 0.0.0.0 (Vite: --host, Next.js: -H 0.0.0.0).";

export function appRows(state: FloorState | null, viewer: AppViewer | null): AppRow[] {
  if (!state) return [];
  const rows: AppRow[] = [];
  for (const s of Object.values(state.services)) {
    const robot = state.robots[s.agentId];
    const owner = robot?.ownerUserId;
    const open: AppOpen = s.localOnly
      ? "localhost"
      : mayControlRobot(viewer, owner)
        ? "control"
        : s.shared && viewer
          ? "watch"
          : "owner_only";
    rows.push({
      id: s.id,
      agentId: s.agentId,
      robot: robot ? `${robot.ownerName}'s ${robot.provider} henchman` : "A henchman",
      title: s.title,
      port: s.port,
      url: s.url,
      open,
    });
  }
  return rows.sort((a, b) => a.robot.localeCompare(b.robot) || a.port - b.port);
}
