import { describe, expect, test } from "bun:test";
import { BuildingState } from "./building-state.ts";
import { buildingFixture } from "./fixtures.ts";
import {
  IDLE_JUKEBOX,
  JukeboxTrack,
  jukeboxAudioPath,
  jukeboxPosition,
  jukeboxTrackEnded,
  mayControlEntry,
  mayManageJukebox,
  mayUseJukebox,
  parseYouTubeId,
  startForPosition,
} from "./jukebox.ts";

describe("jukebox playhead", () => {
  const playing = { playing: true, startedAtServerMs: 10_000, pausedAtMs: 0, durationMs: 60_000 };

  test("while playing the position is server time since the start, clamped to the track", () => {
    expect(jukeboxPosition(playing, 10_000)).toBe(0);
    expect(jukeboxPosition(playing, 12_345)).toBe(2_345);
    expect(jukeboxPosition(playing, 9_000)).toBe(0);
    expect(jukeboxPosition(playing, 999_999)).toBe(60_000);
  });

  test("while paused the position stays where it was paused", () => {
    const paused = { ...playing, playing: false, pausedAtMs: 4_200 };
    expect(jukeboxPosition(paused, 10_000)).toBe(4_200);
    expect(jukeboxPosition(paused, 50_000)).toBe(4_200);
  });

  test("an unknown length never clamps and never ends", () => {
    const open = { ...playing, durationMs: 0 };
    expect(jukeboxPosition(open, 10_000 + 3_600_000)).toBe(3_600_000);
    expect(jukeboxTrackEnded(open, 10_000 + 3_600_000)).toBe(false);
  });

  test("a track ends once its length has played, not while paused", () => {
    expect(jukeboxTrackEnded(playing, 69_999)).toBe(false);
    expect(jukeboxTrackEnded(playing, 70_000)).toBe(true);
    expect(jukeboxTrackEnded({ ...playing, playing: false }, 99_000)).toBe(false);
  });

  test("seeking moves the start so the position lands where asked", () => {
    const start = startForPosition(30_000, 100_000);
    expect(start).toBe(70_000);
    expect(jukeboxPosition({ ...playing, startedAtServerMs: start }, 100_000)).toBe(30_000);
    expect(startForPosition(-5, 100)).toBe(100);
  });
});

describe("jukebox permissions", () => {
  const ada = { userId: "ada", role: "member" as const };
  test("viewers control nothing; members use it; owners and admins manage it", () => {
    expect(mayUseJukebox("viewer")).toBe(false);
    expect(mayUseJukebox("member")).toBe(true);
    expect(mayManageJukebox("member")).toBe(false);
    expect(mayManageJukebox("admin")).toBe(true);
    expect(mayManageJukebox("owner")).toBe(true);
  });

  test("an entry is controlled by its adder, by managers, and by anyone when nobody added it", () => {
    expect(mayControlEntry(ada, { addedBy: "ada" })).toBe(true);
    expect(mayControlEntry(ada, { addedBy: "ben" })).toBe(false);
    expect(mayControlEntry(ada, { addedBy: "" })).toBe(true);
    expect(mayControlEntry({ userId: "x", role: "admin" }, { addedBy: "ben" })).toBe(true);
    expect(mayControlEntry({ userId: "ada", role: "viewer" }, { addedBy: "ada" })).toBe(false);
  });
});

describe("parseYouTubeId", () => {
  test.each([
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["  https://music.youtube.com/watch?v=dQw4w9WgXcQ  ", "dQw4w9WgXcQ"],
  ])("%s → %s", (input, id) => {
    expect(parseYouTubeId(input)).toBe(id);
  });

  test.each([
    "https://evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/playlist?list=PL123",
    "file:///etc/passwd",
    "",
  ])("refuses %s", (input) => {
    expect(parseYouTubeId(input)).toBeNull();
  });
});

describe("jukebox shapes", () => {
  test("the fixture and the idle jukebox are valid state", () => {
    expect(BuildingState.safeParse(buildingFixture).success).toBe(true);
    const idle = { ...buildingFixture, jukebox: { ...IDLE_JUKEBOX, queue: [] } };
    expect(BuildingState.safeParse(idle).success).toBe(true);
  });

  test("a library track parses and its audio path escapes the id", () => {
    const track = {
      id: "t 1",
      title: "Spy Glass",
      artist: "Kevin MacLeod",
      source: "file",
      videoId: "",
      durationMs: 226_977,
      license: "CC-BY-4.0",
      attribution: "x",
      bundled: true,
      addedBy: "",
      addedByName: "",
      createdAt: 0,
    };
    expect(JukeboxTrack.safeParse(track).success).toBe(true);
    expect(jukeboxAudioPath(track.id)).toBe("/api/jukebox/tracks/t%201/audio");
  });
});
