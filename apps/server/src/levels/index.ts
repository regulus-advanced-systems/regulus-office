/**
 * Levels of the lair (SPEC §14 D7, D26; #268): one per GitHub organisation or
 * account that owns an operation repo, plus the lobby level.
 *
 * - store.ts         level rows; `ensureLevelFor` creates an owner's level on first use
 * - owner-lookup.ts  asks GitHub whether an owner is an organisation or an account
 * - ../db/one-repo-per-room.ts  the migration's data step (split, levels)
 *
 * Who may reach a level is not decided here (#267 permissions, #270 enforcement).
 */
export { LevelOwnerLookup, type LevelOwnerLookupDeps } from "./owner-lookup.ts";
export {
  ensureLevelFor,
  type LevelRow,
  levelInfo,
  levelOfOwner,
  shownLevels,
  unconfirmedLevels,
} from "./store.ts";
