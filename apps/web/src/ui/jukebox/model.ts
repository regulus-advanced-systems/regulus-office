/** Pure helpers for the jukebox panel (#47): who may press what, and time labels. */
import {
  type JukeboxQueueEntry,
  type JukeboxState,
  mayControlEntry,
  mayManageJukebox,
  mayUseJukebox,
  type UserRole,
} from "@regulus/protocol";

export interface Viewer {
  userId: string;
  role: UserRole;
}

export interface Controls {
  /** Queue tracks, add music. */
  use: boolean;
  /** Pause, resume, seek and skip what is playing. */
  current: boolean;
  /** The office-wide jukebox volume. */
  manage: boolean;
}

export function controlsFor(viewer: Viewer | null, jukebox: JukeboxState | null): Controls {
  if (!viewer) return { use: false, current: false, manage: false };
  const loaded = Boolean(jukebox && jukebox.current.entryId !== "");
  return {
    use: mayUseJukebox(viewer.role),
    current: loaded && jukebox !== null && mayControlEntry(viewer, jukebox.current),
    manage: mayManageJukebox(viewer.role),
  };
}

export function mayRemove(viewer: Viewer | null, entry: JukeboxQueueEntry): boolean {
  return viewer !== null && mayControlEntry(viewer, entry);
}

/** `m:ss` (or `h:mm:ss`) for a position or length in ms; `--:--` when unknown. */
export function clock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "--:--";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Who queued an entry, for its row. */
export function addedLabel(entry: Pick<JukeboxQueueEntry, "addedBy" | "addedByName">): string {
  return entry.addedBy === ""
    ? "picked by the jukebox"
    : `queued by ${entry.addedByName || "someone"}`;
}

/** The sync readout: how far this page's player is from the server's playhead. */
export function syncLabel(sync: { driftMs: number; action: string } | null): string {
  if (!sync || sync.action === "idle") return "";
  const ms = Math.round(Math.abs(sync.driftMs));
  if (sync.action === "seek") return "Catching up with the office…";
  return `In sync with the office (${ms} ms${sync.action === "nudge" ? ", easing in" : ""})`;
}
