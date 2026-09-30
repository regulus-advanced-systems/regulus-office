/**
 * Claude Code screens that wait for the robot's human before any hook can
 * fire (#158): the first-run onboarding (theme picker, "Select login
 * method", the OAuth paste prompt, "Not logged in · Run /login") and the
 * workspace trust dialog. While one is up the robot would stay "starting"
 * with no sign of why, so the control watches the pane until the first hook
 * arrives and reports `waiting_input` with one of these fixed reasons.
 *
 * Only the pane's last lines are matched, in the office, against fixed
 * phrases; nothing from the pane (the OAuth link included) is stored,
 * logged or forwarded.
 */

export const CLAUDE_SIGN_IN_REASON = "Claude needs you to finish signing in: open its terminal";
export const CLAUDE_TRUST_REASON = "Claude asks whether to trust this folder: open its terminal";

/** Wait reasons meant for the human (shown as the robot's status reason). */
export const HUMAN_WAIT_REASONS: ReadonlySet<string> = new Set([
  CLAUDE_SIGN_IN_REASON,
  CLAUDE_TRUST_REASON,
]);

/** Phrases of Claude Code v2 first-run and login screens (seen in v2.1.285). */
const SIGN_IN_PATTERNS: readonly RegExp[] = [
  /Select login method/i,
  /Choose the text style that looks best with your terminal/i,
  /Paste code here if prompted/i,
  /https:\/\/claude\.(ai|com)\/oauth\/authorize/i,
  /Not logged in\b.*\/login/i,
  /Please run \/login/i,
];

/** The workspace trust dialog (current and earlier wording). */
const TRUST_PATTERNS: readonly RegExp[] = [
  /Yes, I trust this folder/i,
  /Do you trust the files in this folder/i,
  /Is this a project you created or one you trust/i,
];

export type ClaudeBlockingScreen = "sign_in" | "trust";

/**
 * Which blocking screen the pane shows, if any; sign-in wins over trust. The
 * pane's blank rows below the drawn screen (tmux pads to the window height)
 * are dropped first, so `lines` counts only drawn lines.
 */
export function detectBlockingScreen(pane: string, lines = 40): ClaudeBlockingScreen | null {
  const rows = pane.split("\n");
  while (rows.length > 0 && (rows[rows.length - 1] ?? "").trim() === "") rows.pop();
  const tail = rows.slice(-lines).join("\n");
  if (SIGN_IN_PATTERNS.some((re) => re.test(tail))) return "sign_in";
  if (TRUST_PATTERNS.some((re) => re.test(tail))) return "trust";
  return null;
}

export function blockingScreenReason(screen: ClaudeBlockingScreen): string {
  return screen === "sign_in" ? CLAUDE_SIGN_IN_REASON : CLAUDE_TRUST_REASON;
}
