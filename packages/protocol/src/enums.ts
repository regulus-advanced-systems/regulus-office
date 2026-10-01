/**
 * Enumerations shared by server, web client and adapters.
 *
 * Each enum is a readonly `as const` array (single source of truth for zod
 * `z.enum(...)` and runtime checks) plus a derived union type. Values come
 * from docs/SPEC.md §5, §6, §7, §9 and §10 (M5).
 */

// ---- Agents (SPEC §6) -------------------------------------------------------

export const AGENT_STATUSES = [
  "starting",
  "idle",
  "working",
  "waiting_permission",
  "waiting_input",
  "done",
  "error",
  "exited",
  "offline",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_ACTIONS = [
  "none",
  "typing",
  "reading",
  "editing",
  "running_tests",
  "browsing",
  "thinking",
  "failing",
  "celebrating",
] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

// ---- Providers and runners (SPEC §7, §8) ------------------------------------

export const PROVIDER_IDS = [
  "claude-code",
  "codex",
  "gemini-cli",
  "opencode",
  "kimi-code",
  "custom",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const BACKEND_IDS = ["linux-user", "docker"] as const;
export type BackendId = (typeof BACKEND_IDS)[number];

/** How a provider's login is driven from the office UI (SPEC §7 `loginFlow`). */
export const LOGIN_FLOWS = ["device_code", "pty_paste_code", "api_key", "base_url_key"] as const;
export type LoginFlow = (typeof LOGIN_FLOWS)[number];

/** Answer to a permission request (SPEC §7 `respondPermission`). */
export const PERMISSION_DECISIONS = ["allow_once", "allow_always", "reject"] as const;
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];

// ---- Humans and access (SPEC §2, §5) ----------------------------------------

export const USER_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const FLOOR_ACCESSES = ["manage", "spawn", "view"] as const;
export type FloorAccess = (typeof FLOOR_ACCESSES)[number];

/** Clone state of a floor repo on the host (`floor_repos.cloneStatus`). */
export const REPO_CLONE_STATUSES = ["cloning", "ready", "error"] as const;
export type RepoCloneStatus = (typeof REPO_CLONE_STATUSES)[number];

/** Floor layout size tiers (SPEC §9.1, D8); mirrors `ROOM_TIERS` in @regulus/room-layout. */
export const ROOM_TEMPLATE_TIERS = ["small", "medium", "large"] as const;
export type RoomTemplateTier = (typeof ROOM_TEMPLATE_TIERS)[number];

export const CREDENTIAL_AUTH_KINDS = ["cli_login", "api_key", "base_url_key"] as const;
export type CredentialAuthKind = (typeof CREDENTIAL_AUTH_KINDS)[number];

/** Terminal WS connection mode (SPEC §6 channel 3). */
export const TERMINAL_MODES = ["watch", "control"] as const;
export type TerminalMode = (typeof TERMINAL_MODES)[number];

// ---- PM robot (SPEC §10 M5, D4) ---------------------------------------------

export const PM_PRIVILEGES = ["observer", "coordinator", "manager"] as const;
export type PmPrivilege = (typeof PM_PRIVILEGES)[number];

/** What the PM robot is currently doing; drives its animation and label. */
export const PM_ACTIVITIES = ["idle", "patrolling", "visiting", "briefing", "answering"] as const;
export type PmActivity = (typeof PM_ACTIVITIES)[number];

// ---- Queue, boards, usage (SPEC §5) -----------------------------------------

export const TASK_KINDS = ["issue", "pr", "freeform"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const CARD_KINDS = ["issue", "pr"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const USAGE_SOURCES = ["inband", "transcript", "statusline"] as const;
export type UsageSource = (typeof USAGE_SOURCES)[number];

export const LIMIT_WINDOW_KINDS = ["five_hour", "seven_day", "monthly", "credits"] as const;
export type LimitWindowKind = (typeof LIMIT_WINDOW_KINDS)[number];

/** Aggregate CI state of a pull request as shown on the PR board. */
export const CHECKS_STATES = ["none", "pending", "success", "failure"] as const;
export type ChecksState = (typeof CHECKS_STATES)[number];

/** Aggregate review state of a pull request as shown on the PR board. */
export const REVIEW_STATES = ["none", "review_required", "approved", "changes_requested"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

// ---- World objects (SPEC §5, §9) --------------------------------------------

export const DECOR_KINDS = ["picture", "poster", "plant"] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];

export const JUKEBOX_SOURCES = ["file", "youtube", "url"] as const;
export type JukeboxSource = (typeof JUKEBOX_SOURCES)[number];

/** Avatar animation clips (SPEC §9.3). */
export const AVATAR_ANIMATIONS = [
  "idle",
  "walk",
  "sit_type",
  "sit_idle",
  "read",
  "think",
  "celebrate",
  "facepalm",
  "wave",
  "point",
] as const;
export type AvatarAnimation = (typeof AVATAR_ANIMATIONS)[number];

/** Emotes a human can trigger; each maps to a one-shot avatar animation. */
export const EMOTES = ["wave", "point", "celebrate", "facepalm", "think"] as const;
export type Emote = (typeof EMOTES)[number];

/** Screen share destinations (SPEC §9.4: the lounge TV). */
export const SCREEN_SHARE_TARGETS = ["lounge_tv"] as const;
export type ScreenShareTarget = (typeof SCREEN_SHARE_TARGETS)[number];

// ---- Helpers ----------------------------------------------------------------

/** Build a type guard for a readonly string-literal array. */
export function isOneOf<const T extends readonly string[]>(
  values: T,
): (value: unknown) => value is T[number] {
  const set: ReadonlySet<string> = new Set(values);
  return (value: unknown): value is T[number] => typeof value === "string" && set.has(value);
}

export const isAgentStatus = isOneOf(AGENT_STATUSES);
export const isAgentAction = isOneOf(AGENT_ACTIONS);
export const isProviderId = isOneOf(PROVIDER_IDS);
export const isBackendId = isOneOf(BACKEND_IDS);
export const isUserRole = isOneOf(USER_ROLES);
export const isFloorAccess = isOneOf(FLOOR_ACCESSES);
export const isRepoCloneStatus = isOneOf(REPO_CLONE_STATUSES);
export const isCredentialAuthKind = isOneOf(CREDENTIAL_AUTH_KINDS);
export const isPmPrivilege = isOneOf(PM_PRIVILEGES);
