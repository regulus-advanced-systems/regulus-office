/**
 * Levels of the lair (SPEC §14 D26, D7; #251, #268): one level per GitHub
 * organisation and one per personal GitHub account that owns at least one
 * operation repo, plus the shared lobby level. Every operation (one repo, one
 * room) is on the level of its repo's owner; each level has its own grid of
 * rooms, so two rooms on different levels may sit on the same tiles.
 *
 * Who may reach a level and see into its rooms comes from GitHub access
 * (D27) and is enforced separately (#270); until then every level is listed
 * for everyone.
 */
import { z } from "zod";
import { Count, Id } from "./common.ts";

/**
 * - `lobby`: the shared level everyone arrives on; it has no project rooms.
 * - `org` / `account`: a GitHub organisation / a personal GitHub account.
 * - `holding`: rooms whose repo owner is not known (an operation without a
 *   repo). Not a place GitHub knows; listed only while it has rooms.
 */
export const LEVEL_KINDS = ["lobby", "org", "account", "holding"] as const;
export type LevelKind = (typeof LEVEL_KINDS)[number];

/** The two levels that always exist; every other level has a generated id. */
export const LOBBY_LEVEL_ID = "lobby";
export const HOLDING_LEVEL_ID = "holding";

/**
 * One level: who it belongs to. No room counts: what a viewer may know about
 * a level is decided by the visibility rules (#270). `LevelState` in
 * compound.ts adds the level's own layout.
 */
export const LevelInfo = z.object({
  levelId: Id,
  kind: z.enum(LEVEL_KINDS),
  /** GitHub login of the organisation or account, lowercase; empty for the lobby and holding levels. */
  login: z.string().max(64),
  /** Display name: the owner's name on GitHub once known, else its login. */
  name: z.string().max(100),
  /** Position in level lists and in the lift, lobby first. */
  order: Count,
});
export type LevelInfo = z.infer<typeof LevelInfo>;

/** Lobby first, then by `order`, then by name. */
export function sortLevels<T extends Pick<LevelInfo, "levelId" | "order" | "name">>(
  levels: readonly T[],
): T[] {
  return [...levels].sort(
    (a, b) =>
      Number(b.levelId === LOBBY_LEVEL_ID) - Number(a.levelId === LOBBY_LEVEL_ID) ||
      a.order - b.order ||
      a.name.localeCompare(b.name),
  );
}

/** Lowercase login a repo owner's level is keyed by (GitHub logins are case-insensitive). */
export function levelLoginOf(owner: string): string {
  return owner.trim().toLowerCase();
}
