/** The jukebox's playhead, queue, permissions and limits (#47), on the real schema classes. */
import { describe, expect, test } from "bun:test";
import {
  JUKEBOX_LIMITS,
  JukeboxStateSchema,
  type JukeboxTrack,
  jukeboxPosition,
} from "@regulus/protocol";
import { createJukeboxPlayer, type JukeboxTarget, type JukeboxUser } from "./player.ts";
import type { SavedJukebox } from "./state-store.ts";

const track = (
  id: string,
  durationMs: number,
  extra: Partial<JukeboxTrack> = {},
): JukeboxTrack => ({
  id,
  title: `Track ${id}`,
  artist: "Artist",
  source: "file",
  videoId: "",
  durationMs,
  license: "",
  attribution: "",
  bundled: false,
  addedBy: "",
  addedByName: "",
  createdAt: 0,
  ...extra,
});

const LIBRARY = new Map<string, JukeboxTrack>([
  ["a", track("a", 60_000)],
  ["b", track("b", 30_000)],
  ["c", track("c", 45_000)],
  ["bundled:x", track("bundled:x", 100_000, { bundled: true })],
  ["yt", track("yt", 0, { source: "youtube", videoId: "dQw4w9WgXcQ" })],
]);

const mia: JukeboxUser = { userId: "mia", role: "member", displayName: "Mia" };
const ben: JukeboxUser = { userId: "ben", role: "member", displayName: "Ben" };
const olga: JukeboxUser = { userId: "olga", role: "owner", displayName: "Olga" };
const vic: JukeboxUser = { userId: "vic", role: "viewer", displayName: "Vic" };

function setup(saved: SavedJukebox | null = null) {
  const clock = { now: 1_000_000 };
  const saves: SavedJukebox[] = [];
  const durations: Array<[string, number]> = [];
  const player = createJukeboxPlayer({
    track: (id) => LIBRARY.get(id),
    bundled: () => [...LIBRARY.values()].filter((t) => t.bundled),
    setDuration: (id, ms) => durations.push([id, ms]),
    load: () => saved,
    save: (s) => saves.push(s),
    now: () => clock.now,
    random: () => 0,
  });
  const state: JukeboxTarget = new JukeboxStateSchema();
  player.restore(state);
  /** Run a command a little later than the last, past the rate limit. */
  const run = (who: JukeboxUser, c: Parameters<typeof player.command>[2]) => {
    clock.now += JUKEBOX_LIMITS.commandIntervalMs;
    return player.command(state, who, c);
  };
  const position = () =>
    jukeboxPosition(
      {
        playing: state.playing,
        startedAtServerMs: state.startedAtServerMs,
        pausedAtMs: state.pausedAtMs,
        durationMs: state.current.durationMs,
      },
      clock.now,
    );
  return { clock, player, state, run, saves, durations, position };
}

describe("jukebox player: playhead", () => {
  test("enqueue on an idle jukebox starts the track now; the rest wait in order", () => {
    const j = setup();
    expect(j.run(mia, { type: "jukebox.enqueue", trackId: "a" })).toEqual({ ok: true });
    expect(j.state.current.trackId).toBe("a");
    expect(j.state.current.addedBy).toBe("mia");
    expect(j.state.current.addedByName).toBe("Mia");
    expect(j.state.playing).toBe(true);
    expect(j.state.startedAtServerMs).toBe(j.clock.now);
    j.run(ben, { type: "jukebox.enqueue", trackId: "b" });
    j.run(mia, { type: "jukebox.enqueue", trackId: "c" });
    expect(j.state.queue.map((e) => e.trackId)).toEqual(["b", "c"]);
    expect(new Set(j.state.queue.map((e) => e.entryId)).size).toBe(2);
  });

  test("pause holds the position, play resumes from it, seek moves it", () => {
    const j = setup();
    j.run(mia, { type: "jukebox.enqueue", trackId: "a" });
    j.clock.now += 10_000;
    j.run(mia, { type: "jukebox.pause" });
    const held = j.position();
    expect(j.state.playing).toBe(false);
    expect(j.state.pausedAtMs).toBe(held);
    j.clock.now += 50_000;
    expect(j.position()).toBe(held);
    j.run(mia, { type: "jukebox.play" });
    expect(j.state.playing).toBe(true);
    expect(j.position()).toBe(held);
    j.run(mia, { type: "jukebox.seek", positionMs: 42_000 });
    expect(j.position()).toBe(42_000);
    j.clock.now += 1_000;
    expect(j.position()).toBe(43_000);
  });

  test("tick moves on at the end of a track, and stops after the last", () => {
    const j = setup();
    j.run(mia, { type: "jukebox.enqueue", trackId: "b" });
    j.run(mia, { type: "jukebox.enqueue", trackId: "c" });
    j.clock.now += 29_000;
    j.player.tick(j.state);
    expect(j.state.current.trackId).toBe("b");
    j.clock.now += 1_000;
    j.player.tick(j.state);
    expect(j.state.current.trackId).toBe("c");
    expect(j.state.startedAtServerMs).toBe(j.clock.now);
    j.clock.now += 45_000;
    j.player.tick(j.state);
    expect(j.state.current.entryId).toBe("");
    expect(j.state.playing).toBe(false);
  });

  test("seeking past the end skips; play on an idle, empty jukebox picks a bundled track", () => {
    const j = setup();
    j.run(mia, { type: "jukebox.enqueue", trackId: "b" });
    j.run(mia, { type: "jukebox.seek", positionMs: 31_000 });
    expect(j.state.current.entryId).toBe("");
    j.run(ben, { type: "jukebox.play" });
    expect(j.state.current.trackId).toBe("bundled:x");
    expect(j.state.current.addedBy).toBe("");
  });

  test("a YouTube length is taken once from a listener and kept in the library", () => {
    const j = setup();
    j.run(mia, { type: "jukebox.enqueue", trackId: "yt" });
    j.clock.now += 3_600_000;
    j.player.tick(j.state);
    expect(j.state.current.trackId).toBe("yt");
    j.run(ben, { type: "jukebox.duration", trackId: "yt", durationMs: 212_000 });
    j.run(ben, { type: "jukebox.duration", trackId: "yt", durationMs: 1_000 });
    expect(j.state.current.durationMs).toBe(212_000);
    expect(j.durations).toEqual([["yt", 212_000]]);
    j.player.tick(j.state);
    expect(j.state.current.entryId).toBe("");
  });
});

describe("jukebox player: permissions and limits", () => {
  test("only the adder or an owner/admin pauses, seeks, skips or removes", () => {
    const j = setup();
    j.run(mia, { type: "jukebox.enqueue", trackId: "a" });
    j.run(mia, { type: "jukebox.enqueue", trackId: "b" });
    expect(j.run(ben, { type: "jukebox.skip" }).ok).toBe(false);
    expect(j.run(ben, { type: "jukebox.pause" }).ok).toBe(false);
    expect(j.run(ben, { type: "jukebox.seek", positionMs: 1 }).ok).toBe(false);
    expect(j.run(ben, { type: "jukebox.play", trackId: "c" }).ok).toBe(false);
    const waiting = j.state.queue[0]?.entryId ?? "";
    expect(j.run(ben, { type: "jukebox.remove", entryId: waiting }).ok).toBe(false);
    expect(j.state.current.trackId).toBe("a");
    expect(j.run(olga, { type: "jukebox.remove", entryId: waiting }).ok).toBe(true);
    expect(j.state.queue.length).toBe(0);
    expect(j.run(mia, { type: "jukebox.skip" }).ok).toBe(true);
    expect(j.state.current.entryId).toBe("");
  });

  test("anyone controls a track the jukebox picked itself", () => {
    const j = setup();
    j.run(mia, { type: "jukebox.play" });
    expect(j.run(ben, { type: "jukebox.skip" }).ok).toBe(true);
  });

  test("viewers change nothing; only owners and admins set the office volume", () => {
    const j = setup();
    expect(j.run(vic, { type: "jukebox.enqueue", trackId: "a" }).ok).toBe(false);
    expect(j.run(vic, { type: "jukebox.play" }).ok).toBe(false);
    expect(j.run(mia, { type: "jukebox.volume", volume: 0.2 }).ok).toBe(false);
    expect(j.run(olga, { type: "jukebox.volume", volume: 0.25 }).ok).toBe(true);
    expect(j.state.volume).toBe(0.25);
  });

  test("each human has a few tracks waiting at most; owners are not limited; the queue is capped", () => {
    const j = setup();
    j.run(mia, { type: "jukebox.enqueue", trackId: "a" });
    for (let i = 0; i < JUKEBOX_LIMITS.perUserQueued; i++)
      expect(j.run(mia, { type: "jukebox.enqueue", trackId: "b" }).ok).toBe(true);
    const over = j.run(mia, { type: "jukebox.enqueue", trackId: "b" });
    expect(over).toEqual({ ok: false, reason: expect.stringMatching(/already have/) });
    while (j.state.queue.length < JUKEBOX_LIMITS.queueMax)
      expect(j.run(olga, { type: "jukebox.enqueue", trackId: "c" }).ok).toBe(true);
    expect(j.run(olga, { type: "jukebox.enqueue", trackId: "c" }).ok).toBe(false);
  });

  test("unknown tracks are refused; commands faster than the rate limit too", () => {
    const j = setup();
    expect(j.run(mia, { type: "jukebox.enqueue", trackId: "nope" }).ok).toBe(false);
    expect(j.run(mia, { type: "jukebox.enqueue", trackId: "a" }).ok).toBe(true);
    const fast = j.player.command(j.state, mia, { type: "jukebox.enqueue", trackId: "b" });
    expect(fast.ok).toBe(false);
    // Someone else is not slowed down by Mia.
    expect(j.player.command(j.state, ben, { type: "jukebox.enqueue", trackId: "b" }).ok).toBe(true);
  });
});

describe("jukebox player: saving", () => {
  test("every change is saved, and a restore picks up the playhead and the queue", () => {
    const j = setup();
    j.run(mia, { type: "jukebox.enqueue", trackId: "a" });
    j.run(ben, { type: "jukebox.enqueue", trackId: "b" });
    j.run(mia, { type: "jukebox.pause" });
    const last = j.saves.at(-1);
    expect(last?.current?.trackId).toBe("a");
    expect(last?.queue.map((e) => e.trackId)).toEqual(["b"]);
    expect(last?.playing).toBe(false);

    const again = setup(last ?? null);
    expect(again.state.current.entryId).toBe(last?.current?.entryId ?? "x");
    expect(again.state.playing).toBe(false);
    expect(again.state.pausedAtMs).toBe(last?.pausedAtMs ?? -1);
    expect(again.state.queue.map((e) => e.addedBy)).toEqual(["ben"]);
  });

  test("a saved track that left the library is not restored", () => {
    const j = setup({
      current: {
        entryId: "e",
        trackId: "gone",
        title: "",
        artist: "",
        source: "file",
        videoId: "",
        durationMs: 1,
        addedBy: "",
        addedByName: "",
      },
      queue: [],
      startedAtServerMs: 1,
      pausedAtMs: 0,
      playing: true,
      volume: 0.4,
    });
    expect(j.state.current.entryId).toBe("");
    expect(j.state.volume).toBe(0.4);
  });
});
