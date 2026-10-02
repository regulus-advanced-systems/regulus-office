/**
 * The jukebox's playhead and queue survive restarts (#47): one row of
 * `jukebox_state`, rewritten after every change. `queue_json` holds
 * `{ current, queue }` as plain entries; `track_id` mirrors the current
 * track so deleting a track clears it.
 */
import { DEFAULT_JUKEBOX_VOLUME, JukeboxQueueEntry } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/index.ts";
import { jukeboxState } from "../db/schema/index.ts";

/** The single row's id: the lobby jukebox. */
export const JUKEBOX_ROW_ID = "lobby";

export interface SavedJukebox {
  current: JukeboxQueueEntry | null;
  queue: JukeboxQueueEntry[];
  startedAtServerMs: number;
  pausedAtMs: number;
  playing: boolean;
  volume: number;
}

const Saved = z.object({
  current: JukeboxQueueEntry.nullable(),
  queue: z.array(JukeboxQueueEntry),
});

export class JukeboxStateStore {
  constructor(private readonly db: Db) {}

  load(): SavedJukebox | null {
    const row = this.db
      .select()
      .from(jukeboxState)
      .where(eq(jukeboxState.id, JUKEBOX_ROW_ID))
      .get();
    if (!row) return null;
    let saved: z.infer<typeof Saved>;
    try {
      saved = Saved.parse(JSON.parse(row.queueJson));
    } catch {
      saved = { current: null, queue: [] };
    }
    // The current track was deleted (track_id set null): it cannot play any more.
    const current = row.trackId && saved.current?.trackId === row.trackId ? saved.current : null;
    return {
      current,
      queue: saved.queue,
      startedAtServerMs: row.startedAtServerMs ?? 0,
      pausedAtMs: row.pausedAtMs ?? 0,
      playing: current !== null && row.pausedAtMs === null,
      volume: Number.isFinite(row.volume) ? row.volume : DEFAULT_JUKEBOX_VOLUME,
    };
  }

  save(state: SavedJukebox): void {
    const values = {
      trackId: state.current?.trackId ?? null,
      startedAtServerMs: state.current ? state.startedAtServerMs : null,
      pausedAtMs: state.current && !state.playing ? state.pausedAtMs : null,
      volume: state.volume,
      queueJson: JSON.stringify({ current: state.current, queue: state.queue }),
    };
    this.db
      .insert(jukeboxState)
      .values({ id: JUKEBOX_ROW_ID, ...values })
      .onConflictDoUpdate({ target: jukeboxState.id, set: values })
      .run();
  }
}
