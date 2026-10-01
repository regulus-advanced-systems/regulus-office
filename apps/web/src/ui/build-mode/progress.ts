/**
 * How far a room's build phase is (#187), for the door plate and the
 * status panel. The server publishes only when the build ends
 * (`buildEndsAt`); the client takes the time left when it first saw the
 * room building as the whole phase. Pure but for that first sighting.
 */

const firstSeen = new Map<string, { endsAt: number; total: number }>();

export interface BuildProgress {
  remainingMs: number;
  /** 0 just started .. 1 done. */
  fraction: number;
}

export function buildProgress(
  roomId: string,
  endsAt: number,
  now: number,
  building = true,
): BuildProgress {
  if (!building || endsAt <= 0) {
    firstSeen.delete(roomId);
    return { remainingMs: 0, fraction: 1 };
  }
  const remainingMs = Math.max(0, endsAt - now);
  let seen = firstSeen.get(roomId);
  if (!seen || seen.endsAt !== endsAt) {
    seen = { endsAt, total: Math.max(remainingMs, 1000) };
    firstSeen.set(roomId, seen);
    if (firstSeen.size > 64) firstSeen.delete(firstSeen.keys().next().value ?? "");
  }
  return { remainingMs, fraction: Math.min(1, Math.max(0, 1 - remainingMs / seen.total)) };
}

/** "0:14", or "finishing" once the time is up and the server has not said so yet. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "finishing";
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
