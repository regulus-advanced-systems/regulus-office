/** tmux session naming (SPEC §4.4: sessions are named `agent-<agentId>`). */

const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const TMUX_SESSION_PREFIX = "agent-";

/** `agent-<agentId>`; rejects ids tmux would mangle (`.` and `:` are target separators). */
export function tmuxSessionName(agentId: string): string {
  if (!AGENT_ID.test(agentId))
    throw new Error(`Agent id not usable in a tmux session name: ${agentId}`);
  return `${TMUX_SESSION_PREFIX}${agentId}`;
}

/** Inverse of `tmuxSessionName`; null for sessions the office did not create. */
export function agentIdFromSession(session: string): string | null {
  if (!session.startsWith(TMUX_SESSION_PREFIX)) return null;
  const id = session.slice(TMUX_SESSION_PREFIX.length);
  return AGENT_ID.test(id) ? id : null;
}
