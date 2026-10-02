/**
 * Who has the lounge TV (#48, SPEC §6 `screen.share.start|stop`, §9.4).
 * One sharer at a time, marked by `HumanPresence.sharingScreen`; the
 * screen itself goes browser → LiveKit → browsers, never through the
 * office. Every client draws the TV from the participant whose identity is
 * the sharer's session, so a screen published without the server's say-so
 * never reaches the TV.
 *
 * - start: media configured, not a viewer, in the lobby (or its corridors
 *   and special rooms: the human's `operationId` is the lobby), and nobody
 *   else sharing. Starting again while sharing is a no-op.
 * - stop: the sharer, or an owner/admin for someone else's share (audited).
 *   A sharer who leaves the office stops sharing with their presence.
 */
import {
  LOBBY_OPERATION_ID,
  mayShareScreen,
  mayStopAnyScreenShare,
  SCREEN_SHARE_REJECTIONS,
  screenBusyReason,
  type UserRole,
} from "@regulus/protocol";

/** The presence fields the rules read and write. */
export interface SharingHuman {
  userId: string;
  displayName: string;
  operationId: string;
  sharingScreen: boolean;
}

export interface Humans<H extends SharingHuman> {
  get(sessionId: string): H | undefined;
  forEach(cb: (human: H, sessionId: string) => void): void;
}

export interface ScreenShareActor {
  userId: string;
  role: UserRole;
}

/** An owner/admin took someone else's screen off the TV. */
export interface ScreenShareTakedown {
  byUserId: string;
  userId: string;
  sessionId: string;
}

export interface ScreenShareOptions {
  /** LiveKit is configured. */
  enabled: boolean;
  /** Record a takedown (audit log). */
  audit?(takedown: ScreenShareTakedown): void;
}

export type ShareResult = { ok: true } | { ok: false; reason: string };

export interface ScreenShareRules {
  start<H extends SharingHuman>(
    humans: Humans<H>,
    sessionId: string,
    actor: ScreenShareActor,
  ): ShareResult;
  stop<H extends SharingHuman>(
    humans: Humans<H>,
    sessionId: string,
    actor: ScreenShareActor,
    target?: string,
  ): ShareResult;
  /** `start` or `stop` for a parsed command. */
  apply<H extends SharingHuman>(
    humans: Humans<H>,
    sessionId: string,
    actor: ScreenShareActor,
    command: { type: "screen.share.start" } | { type: "screen.share.stop"; sessionId?: string },
  ): ShareResult;
}

/** The session sharing the TV now, if any. */
export function currentSharer<H extends SharingHuman>(
  humans: Humans<H>,
): { sessionId: string; human: H } | null {
  let found: { sessionId: string; human: H } | null = null;
  humans.forEach((human, sessionId) => {
    if (!found && human.sharingScreen) found = { sessionId, human };
  });
  return found;
}

export function createScreenShareRules(options: ScreenShareOptions): ScreenShareRules {
  const refuse = (reason: string): ShareResult => ({ ok: false, reason });
  const rules: ScreenShareRules = {
    apply(humans, sessionId, actor, command) {
      return command.type === "screen.share.start"
        ? rules.start(humans, sessionId, actor)
        : rules.stop(humans, sessionId, actor, command.sessionId);
    },

    start(humans, sessionId, actor) {
      const human = humans.get(sessionId);
      if (!human) return refuse(SCREEN_SHARE_REJECTIONS.notSharing);
      if (!options.enabled) return refuse(SCREEN_SHARE_REJECTIONS.disabled);
      if (!mayShareScreen(actor.role)) return refuse(SCREEN_SHARE_REJECTIONS.viewer);
      if (human.sharingScreen) return { ok: true };
      if (human.operationId !== LOBBY_OPERATION_ID)
        return refuse(SCREEN_SHARE_REJECTIONS.notInLobby);
      const sharer = currentSharer(humans);
      if (sharer) return refuse(screenBusyReason(sharer.human.displayName));
      human.sharingScreen = true;
      return { ok: true };
    },

    stop(humans, sessionId, actor, target) {
      const targetId = target ?? sessionId;
      const human = humans.get(targetId);
      if (targetId === sessionId) {
        if (human?.sharingScreen) human.sharingScreen = false;
        return { ok: true };
      }
      if (!mayStopAnyScreenShare(actor.role)) return refuse(SCREEN_SHARE_REJECTIONS.notYours);
      if (!human?.sharingScreen) return refuse(SCREEN_SHARE_REJECTIONS.notSharing);
      human.sharingScreen = false;
      options.audit?.({ byUserId: actor.userId, userId: human.userId, sessionId: targetId });
      return { ok: true };
    },
  };
  return rules;
}
