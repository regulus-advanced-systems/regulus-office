/**
 * The lobby jukebox in the BuildingRoom (#47, SPEC §6, §9.4): the server is
 * the playhead authority. It owns `startedAtServerMs` (server time at which
 * position 0 would have played) and the queue; every client derives the
 * position from it and its synced clock (protocol jukebox.ts, clock-sync.ts).
 *
 * Who may do what (protocol `mayControlEntry`): viewers nothing; anyone else
 * queues tracks (up to `perUserQueued` waiting, owners/admins unlimited, the
 * queue holds `queueMax`); pause, seek, skip and remove belong to the entry's
 * adder, to owners/admins, and to everyone for a track the jukebox picked
 * itself. The office volume is for owners/admins. One command per human per
 * `commandIntervalMs`. The room's sweep calls `tick`, which moves on when a
 * track has played to its end. Every change is saved (state-store.ts).
 */
import {
  JUKEBOX_LIMITS,
  type JukeboxActor,
  type JukeboxQueueEntry,
  JukeboxQueueEntrySchema,
  type JukeboxStateSchema,
  type JukeboxTrack,
  jukeboxPosition,
  jukeboxTrackEnded,
  mayControlEntry,
  mayManageJukebox,
  mayUseJukebox,
  NO_JUKEBOX_ENTRY,
  startForPosition,
} from "@regulus/protocol";
import type { SavedJukebox } from "./state-store.ts";

export type JukeboxTarget = InstanceType<typeof JukeboxStateSchema>;
type EntrySchema = InstanceType<typeof JukeboxQueueEntrySchema>;

/** The jukebox commands the BuildingRoom hands over (protocol commands/lobby.ts). */
export type JukeboxCommand =
  | { type: "jukebox.play"; trackId?: string }
  | { type: "jukebox.pause" }
  | { type: "jukebox.seek"; positionMs: number }
  | { type: "jukebox.enqueue"; trackId: string }
  | { type: "jukebox.skip" }
  | { type: "jukebox.remove"; entryId: string }
  | { type: "jukebox.volume"; volume: number }
  | { type: "jukebox.duration"; trackId: string; durationMs: number };

export interface JukeboxUser extends JukeboxActor {
  displayName: string;
}

export type JukeboxResult = { ok: true } | { ok: false; reason: string };

export interface JukeboxPlayerDeps {
  /** Look a library track up (JukeboxLibrary.get). */
  track(id: string): JukeboxTrack | undefined;
  /** Bundled tracks, for "play" on an idle jukebox with an empty queue. */
  bundled(): JukeboxTrack[];
  /** Remember a measured length (JukeboxLibrary.setDuration). */
  setDuration?(id: string, durationMs: number): void;
  load?(): SavedJukebox | null;
  save?(state: SavedJukebox): void;
  now?: () => number;
  random?: () => number;
}

export interface JukeboxPlayer {
  /** Put the saved state (if any) into a fresh room state. */
  restore(target: JukeboxTarget): void;
  command(target: JukeboxTarget, actor: JukeboxUser, command: JukeboxCommand): JukeboxResult;
  /** Move on from a track that has played to its end; cheap, called from the room's sweep. */
  tick(target: JukeboxTarget): void;
}

const fail = (reason: string): JukeboxResult => ({ ok: false, reason });
const OK: JukeboxResult = { ok: true };

function copyEntry(into: EntrySchema, from: JukeboxQueueEntry): EntrySchema {
  into.entryId = from.entryId;
  into.trackId = from.trackId;
  into.title = from.title;
  into.artist = from.artist;
  into.source = from.source;
  into.videoId = from.videoId;
  into.durationMs = from.durationMs;
  into.addedBy = from.addedBy;
  into.addedByName = from.addedByName;
  return into;
}

function plainEntry(e: EntrySchema): JukeboxQueueEntry {
  return {
    entryId: e.entryId,
    trackId: e.trackId,
    title: e.title,
    artist: e.artist,
    source: e.source as JukeboxQueueEntry["source"],
    videoId: e.videoId,
    durationMs: e.durationMs,
    addedBy: e.addedBy,
    addedByName: e.addedByName,
  };
}

export function entryFor(track: JukeboxTrack, by: { userId: string; displayName: string } | null) {
  return {
    entryId: crypto.randomUUID(),
    trackId: track.id,
    title: track.title.slice(0, 200),
    artist: track.artist.slice(0, 200),
    source: track.source,
    videoId: track.videoId,
    durationMs: track.durationMs,
    addedBy: by?.userId ?? "",
    addedByName: (by?.displayName ?? "").slice(0, 64),
  } satisfies JukeboxQueueEntry;
}

export function createJukeboxPlayer(deps: JukeboxPlayerDeps): JukeboxPlayer {
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const lastCommand = new Map<string, number>();

  const loaded = (t: JukeboxTarget) => t.current.entryId !== "";
  const playhead = (t: JukeboxTarget) => ({
    playing: t.playing,
    startedAtServerMs: t.startedAtServerMs,
    pausedAtMs: t.pausedAtMs,
    durationMs: t.current.durationMs,
  });

  const save = (t: JukeboxTarget) => {
    deps.save?.({
      current: loaded(t) ? plainEntry(t.current) : null,
      queue: t.queue.map(plainEntry),
      startedAtServerMs: t.startedAtServerMs,
      pausedAtMs: t.pausedAtMs,
      playing: t.playing,
      volume: t.volume,
    });
  };

  /** Load `entry` (or nothing) and start it at `positionMs`. */
  const load = (t: JukeboxTarget, entry: JukeboxQueueEntry | null, positionMs = 0) => {
    copyEntry(t.current, entry ?? NO_JUKEBOX_ENTRY);
    t.playing = entry !== null;
    t.pausedAtMs = 0;
    t.startedAtServerMs = entry ? startForPosition(positionMs, now()) : 0;
  };

  /** The next waiting entry whose track still exists, or nothing. */
  const advance = (t: JukeboxTarget) => {
    while (t.queue.length > 0) {
      const next = t.queue.shift() as EntrySchema;
      const entry = plainEntry(next);
      const track = deps.track(entry.trackId);
      if (!track) continue;
      // A YouTube length measured while it waited.
      load(t, { ...entry, durationMs: entry.durationMs || track.durationMs });
      return;
    }
    load(t, null);
  };

  const waitingBy = (t: JukeboxTarget, userId: string) =>
    t.queue.filter((e) => e.addedBy === userId).length;

  const run = (t: JukeboxTarget, actor: JukeboxUser, c: JukeboxCommand): JukeboxResult => {
    const controlCurrent = () => mayControlEntry(actor, t.current);
    switch (c.type) {
      case "jukebox.enqueue": {
        const track = deps.track(c.trackId);
        if (!track) return fail("That track is not in the jukebox any more.");
        if (track.source === "url") return fail("The jukebox only plays files and YouTube.");
        if (t.queue.length >= JUKEBOX_LIMITS.queueMax)
          return fail(`The queue is full (${JUKEBOX_LIMITS.queueMax} tracks).`);
        if (
          !mayManageJukebox(actor.role) &&
          waitingBy(t, actor.userId) >= JUKEBOX_LIMITS.perUserQueued
        )
          return fail(`You already have ${JUKEBOX_LIMITS.perUserQueued} tracks waiting.`);
        const entry = entryFor(track, actor);
        if (!loaded(t)) load(t, entry);
        else t.queue.push(copyEntry(new JukeboxQueueEntrySchema(), entry));
        return OK;
      }
      case "jukebox.play": {
        if (c.trackId !== undefined) {
          const track = deps.track(c.trackId);
          if (!track || track.source === "url") return fail("That track is not in the jukebox.");
          if (loaded(t) && !controlCurrent())
            return fail(`${t.current.addedByName || "Someone"} queued what is playing.`);
          load(t, entryFor(track, actor));
          return OK;
        }
        if (loaded(t)) {
          if (t.playing) return OK;
          if (!controlCurrent()) return fail("Only who queued this track can resume it.");
          t.startedAtServerMs = startForPosition(t.pausedAtMs, now());
          t.pausedAtMs = 0;
          t.playing = true;
          return OK;
        }
        if (t.queue.length > 0) {
          advance(t);
          return OK;
        }
        const pool = deps.bundled();
        const pick = pool[Math.floor(random() * pool.length)];
        if (!pick) return fail("The jukebox has nothing to play.");
        load(t, entryFor(pick, null));
        return OK;
      }
      case "jukebox.pause": {
        if (!loaded(t) || !t.playing) return OK;
        if (!controlCurrent()) return fail("Only who queued this track can pause it.");
        t.pausedAtMs = Math.round(jukeboxPosition(playhead(t), now()));
        t.playing = false;
        return OK;
      }
      case "jukebox.seek": {
        if (!loaded(t)) return fail("Nothing is playing.");
        if (!controlCurrent()) return fail("Only who queued this track can seek in it.");
        const duration = t.current.durationMs;
        if (duration > 0 && c.positionMs >= duration) {
          advance(t);
          return OK;
        }
        if (t.playing) t.startedAtServerMs = startForPosition(c.positionMs, now());
        else t.pausedAtMs = c.positionMs;
        return OK;
      }
      case "jukebox.skip": {
        if (!loaded(t)) return OK;
        if (!controlCurrent()) return fail("Only who queued this track can skip it.");
        advance(t);
        return OK;
      }
      case "jukebox.remove": {
        const i = t.queue.findIndex((e) => e.entryId === c.entryId);
        if (i < 0) return OK;
        if (!mayControlEntry(actor, t.queue[i] as EntrySchema))
          return fail("Only who queued a track can take it off the queue.");
        t.queue.splice(i, 1);
        return OK;
      }
      case "jukebox.volume": {
        if (!mayManageJukebox(actor.role))
          return fail("Only owners and admins set the jukebox volume.");
        t.volume = Math.round(c.volume * 100) / 100;
        return OK;
      }
      case "jukebox.duration": {
        if (t.current.trackId !== c.trackId || t.current.durationMs > 0) return OK;
        if (t.current.source !== "youtube") return OK;
        if (c.durationMs < JUKEBOX_LIMITS.minDurationMs) return OK;
        const ms = Math.min(c.durationMs, JUKEBOX_LIMITS.maxYouTubeDurationMs);
        t.current.durationMs = ms;
        deps.setDuration?.(c.trackId, ms);
        return OK;
      }
    }
  };

  return {
    restore(t) {
      const saved = deps.load?.();
      if (!saved) return;
      t.volume = saved.volume;
      for (const e of saved.queue) t.queue.push(copyEntry(new JukeboxQueueEntrySchema(), e));
      if (saved.current && deps.track(saved.current.trackId)) {
        copyEntry(t.current, saved.current);
        t.startedAtServerMs = saved.startedAtServerMs;
        t.pausedAtMs = saved.pausedAtMs;
        t.playing = saved.playing;
      }
    },

    command(t, actor, c) {
      if (!mayUseJukebox(actor.role)) return fail("Viewers can listen but not change the music.");
      // Reports of a measured length are not the human's doing: no rate limit.
      if (c.type !== "jukebox.duration") {
        const at = now();
        const last = lastCommand.get(actor.userId);
        if (last !== undefined && at - last < JUKEBOX_LIMITS.commandIntervalMs)
          return fail("Easy on the jukebox: one button at a time.");
        // Old entries can never refuse again; keep the map small.
        for (const [id, when] of lastCommand)
          if (at - when >= JUKEBOX_LIMITS.commandIntervalMs) lastCommand.delete(id);
        lastCommand.set(actor.userId, at);
      }
      const result = run(t, actor, c);
      if (result.ok) save(t);
      return result;
    },

    tick(t) {
      if (!loaded(t)) return;
      // A video nobody measured (no listener had YouTube) still ends, at the longest we take.
      const ended =
        jukeboxTrackEnded(playhead(t), now()) ||
        (t.playing &&
          t.current.durationMs === 0 &&
          now() - t.startedAtServerMs >= JUKEBOX_LIMITS.maxYouTubeDurationMs);
      if (!ended) return;
      advance(t);
      save(t);
    },
  };
}
