/** Viewer faces and "X is typing" for the terminal modal header. */
import type { TerminalPeer } from "@regulus/protocol";
import { COLOR_SET_IDS, colorSetFor } from "../../scene/avatar/colorSets.ts";
import { uniquePeers } from "./terminalState.ts";

const MAX_FACES = 6;

/** Stable colour per user id, from the robot colour sets (SPEC §9.3). */
export function faceColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return colorSetFor(COLOR_SET_IDS[h % COLOR_SET_IDS.length]).primary;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? `${parts[0]?.[0]}${parts.at(-1)?.[0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export interface TerminalPeopleProps {
  viewers: number;
  peers: readonly TerminalPeer[];
  selfId?: string;
  typing: { userId: string; name: string } | null;
}

export function TerminalPeople({ viewers, peers, selfId, typing }: TerminalPeopleProps) {
  const people = uniquePeers(peers);
  const shown = people.slice(0, MAX_FACES);
  const typist = typing && typing.userId !== selfId ? typing.name : null;
  return (
    <div className="rg-term__people">
      {typist && (
        <span className="rg-term__typing" data-testid="terminal-typing" aria-live="polite">
          {typist} is typing…
        </span>
      )}
      <ul className="rg-term__faces" aria-label="People watching">
        {shown.map((p) => (
          <li
            key={p.userId}
            className={`rg-term__face${p.mode === "control" ? " rg-term__face--control" : ""}`}
            style={{ background: faceColor(p.userId) }}
            title={`${p.name}${p.userId === selfId ? " (you)" : ""}: ${p.mode === "control" ? "in control" : "watching"}`}
          >
            {initials(p.name)}
          </li>
        ))}
      </ul>
      <span className="rg-term__count" data-testid="terminal-viewers">
        {viewers} {viewers === 1 ? "viewer" : "viewers"}
      </span>
    </div>
  );
}
