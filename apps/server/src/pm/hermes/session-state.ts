/**
 * What the Hermes engine keeps across restarts (#58), in the agent's engine
 * state: which Hermes session each person's office conversation runs in.
 * Session ids are names, not credentials.
 */
import type { EngineAgent, EngineMessage } from "../engines/types.ts";

export interface SessionState extends Record<string, unknown> {
  v: 1;
  /** Office person id -> the Hermes session of their conversation with this agent. */
  sessions: Record<string, string>;
  /** The session the owner asked to continue, when the map was built for it. */
  continues?: string;
}

/**
 * The stored map, unless the owner has since changed which session to
 * continue (or stopped continuing one): then every conversation starts over
 * on the new choice.
 */
export function readSessionState(
  stored: Record<string, unknown>,
  continues: string | undefined,
): SessionState {
  const sessions: Record<string, string> = {};
  const before = typeof stored.continues === "string" ? stored.continues : undefined;
  const raw = stored.sessions;
  if (before === continues && raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [userId, id] of Object.entries(raw)) {
      if (typeof id === "string" && id.length > 0 && id.length <= 256) sessions[userId] = id;
    }
  }
  return { v: 1, sessions, ...(continues ? { continues } : {}) };
}

/**
 * What Hermes is told with every office message (its `system_message`, which
 * applies to that turn only and is not stored in its transcript): where the
 * message comes from, and the document its owner keeps in the office about
 * who it is and how it works there (its soul, #136), as it is at this turn.
 *
 * The office's memories and notes are not sent, and nothing maps them onto
 * Hermes's own memory (MEMORY.md, USER.md, past sessions): that would be
 * built here, from `EngineMind.digest()`.
 */
export function officeSystemMessage(
  agent: EngineAgent,
  message: EngineMessage,
  soul: string,
): string {
  const lines = [
    `This message reaches you through the Regulus Office, a shared virtual office where you are present as "${agent.name}". It is from ${message.fromName}, the person you belong to. Your reply is shown to them there.`,
    'If an MCP server named "office" is configured, its tools act in that office with exactly this person\'s rights.',
  ];
  // The soul is the instructions' successor; an engine started without one still has the row's text.
  const document = (soul || agent.instructions).trim();
  if (document) {
    lines.push(`Who you are and how you work in the office, as written there:\n${document}`);
  }
  return lines.join("\n\n");
}
