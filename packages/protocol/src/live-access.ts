/**
 * Close codes for a connection the office ends because the human behind it
 * no longer has the access it was opened with (#244, SPEC §11, D27). Every
 * long-lived connection uses the same three codes: the whiteboard
 * (`/ws/wb`), terminals (`/ws/term`), the laptop screen feed (`/ws/screens`),
 * the BuildingRoom and OperationRooms, and proxied app WebSockets.
 *
 * A client must not treat `signedOut` or `revoked` as a dropped connection:
 * retrying cannot help, so it shows the plain message and stops. `changed`
 * means "you still have access, but a different one" (edit became read-only,
 * the office role changed): the client connects once more and gets what it
 * may have now.
 */
export const ACCESS_CLOSE_CODES = {
  /** The session ended (signed out, expired) or the account is gone. */
  signedOut: 4401,
  /** No access any more: removed from the room, or the room was archived or deleted. */
  revoked: 4403,
  /** Access is still there but different: connect again for the current one. */
  changed: 4409,
} as const;

export type AccessCloseKind = keyof typeof ACCESS_CLOSE_CODES;

/** Close reasons sent with the codes (short, fixed, no user data). */
export const ACCESS_CLOSE_REASONS: Record<AccessCloseKind, string> = {
  signedOut: "signed out",
  revoked: "access revoked",
  changed: "access changed",
};

/** Which access close a WebSocket close code is, or null for any other code. */
export function accessCloseKind(code: number): AccessCloseKind | null {
  if (code === ACCESS_CLOSE_CODES.signedOut) return "signedOut";
  if (code === ACCESS_CLOSE_CODES.revoked) return "revoked";
  if (code === ACCESS_CLOSE_CODES.changed) return "changed";
  return null;
}

/** True when reconnecting cannot help: show {@link accessCloseMessage} and stop. */
export function isFinalAccessClose(code: number): boolean {
  const kind = accessCloseKind(code);
  return kind === "signedOut" || kind === "revoked";
}

/** What the human reads; `what` names the thing that closed ("room", "whiteboard", "terminal"). */
export function accessCloseMessage(kind: AccessCloseKind, what = "room"): string {
  if (kind === "signedOut") return "You were signed out. Sign in again to continue.";
  if (kind === "revoked") return `You no longer have access to this ${what}.`;
  return `Your access to this ${what} changed.`;
}
