/**
 * The picture beside a level's name (#269): the GitHub avatar of the
 * organisation or account the level belongs to, a monogram until it loads
 * or when it cannot (offline, an unknown login), and a drawn emblem for the
 * lobby and holding levels, which are nobody's on GitHub.
 */
import type { LevelInfo } from "@regulus/protocol";
import { useState } from "react";

/** GitHub serves an owner's avatar at this address for organisations and accounts alike. */
export function levelAvatarUrl(level: Pick<LevelInfo, "kind" | "login">, size = 96): string | null {
  if ((level.kind !== "org" && level.kind !== "account") || !level.login) return null;
  return `https://github.com/${encodeURIComponent(level.login)}.png?size=${size}`;
}

/** Up to two letters for the monogram: the first letters of the name's first two words. */
export function levelMonogram(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase() || "?";
}

function Emblem({ kind }: { kind: LevelInfo["kind"] }) {
  // The lobby: the mountain with its blast door. Holding: a crate.
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
      {kind === "lobby" ? (
        <>
          <path d="M3 26 L13 8 L18 15 L22 11 L29 26 Z" fill="currentColor" opacity="0.55" />
          <rect x="12" y="19" width="8" height="7" fill="currentColor" />
          <rect x="15.5" y="19" width="1" height="7" fill="#1c1d1f" />
        </>
      ) : (
        <>
          <rect x="6" y="9" width="20" height="17" fill="currentColor" opacity="0.55" />
          <path d="M6 9 L26 26 M26 9 L6 26" stroke="currentColor" strokeWidth="2.4" />
          <rect
            x="6"
            y="9"
            width="20"
            height="17"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
        </>
      )}
    </svg>
  );
}

export function LevelAvatar({ level }: { level: Pick<LevelInfo, "kind" | "login" | "name"> }) {
  const url = levelAvatarUrl(level);
  const [failed, setFailed] = useState(false);
  return (
    <span className="rg-lift__avatar" data-kind={level.kind}>
      {url === null ? (
        <Emblem kind={level.kind} />
      ) : (
        <>
          <span aria-hidden="true">{levelMonogram(level.name)}</span>
          {!failed && (
            <img
              src={url}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              draggable={false}
              onError={() => setFailed(true)}
            />
          )}
        </>
      )}
    </span>
  );
}
