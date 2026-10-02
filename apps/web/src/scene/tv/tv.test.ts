/** The lounge TV (#48): where it stands, the sofa that faces it, and the screen texture binding. */
import { describe, expect, test } from "bun:test";
import { LOBBY_OPERATION_ID, seatKey } from "@regulus/protocol";
import { specialRoomSeats } from "@regulus/room-layout";
import { VideoTexture } from "three";
import { specialDressing } from "../compound/special.ts";
import { inTvRange, isTvSofaSeat, TV_REACH, tvSpot } from "./spot.ts";
import { bindTvTexture, fitToScreen } from "./tvTexture.ts";

const LOBBY = { w: 24, d: 16 };
const world = {
  rooms: [
    {
      id: LOBBY_OPERATION_ID,
      kind: "lobby",
      origin: { x: 52, z: 112 },
      size: LOBBY,
    },
  ],
} as unknown as Parameters<typeof tvSpot>[0];

const overlaps = (
  a: { x: number; z: number; w: number; d: number },
  b: { x: number; z: number; w: number; d: number },
) => a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;

describe("lounge TV placement", () => {
  test("stands in the lobby facing the sofa, clear of the other furniture", () => {
    const dressing = specialDressing("lobby", LOBBY.w, LOBBY.d);
    const tv = dressing.tv;
    if (!tv) throw new Error("no TV in the lobby");
    expect(tv.facing).toBe("south");
    for (const f of dressing.furniture) expect(overlaps(tv.rect, f.rect)).toBe(false);
    const sofa = specialRoomSeats("lobby", LOBBY.w, LOBBY.d).filter((s) => s.id.startsWith("sofa"));
    expect(sofa).toHaveLength(3);
    // Centred on the sofa, in front of it (north), the sofa facing it.
    const middle = sofa[1];
    expect(Math.abs((middle?.pose.x ?? 0) - (tv.rect.x + tv.rect.w / 2))).toBeLessThan(0.01);
    expect((middle?.pose.z ?? 0) > tv.rect.z).toBe(true);
    expect(middle?.pose.heading).toBe(0); // north, towards the TV
  });

  test("the spot in compound metres, and where to stand to use it", () => {
    const spot = tvSpot(world);
    if (!spot) throw new Error("no spot");
    const tv = specialDressing("lobby", LOBBY.w, LOBBY.d).tv;
    expect(spot.x).toBeCloseTo(52 + (tv?.rect.x ?? 0) + (tv?.rect.w ?? 0) / 2);
    expect(spot.stand.z).toBeGreaterThan(spot.z);
    expect(Math.hypot(spot.stand.x - spot.x, spot.stand.z - spot.z)).toBeLessThan(TV_REACH + 1);
    expect(spot.roomId).toBe(LOBBY_OPERATION_ID);
    expect(tvSpot(null)).toBeNull();
    expect(inTvRange(spot, spot.stand.x, spot.stand.z, LOBBY_OPERATION_ID)).toBe(true);
    expect(inTvRange(spot, spot.stand.x, spot.stand.z, "op-1")).toBe(false);
    expect(inTvRange(spot, spot.x + 40, spot.z, LOBBY_OPERATION_ID)).toBe(false);
  });

  test("only the lobby sofa's seats focus the TV", () => {
    expect(isTvSofaSeat(seatKey(LOBBY_OPERATION_ID, "sofa-2"))).toBe(true);
    expect(isTvSofaSeat(seatKey(LOBBY_OPERATION_ID, "armchair-w"))).toBe(false);
    expect(isTvSofaSeat(seatKey("break_room", "couch-1"))).toBe(false);
    expect(isTvSofaSeat("")).toBe(false);
    expect(isTvSofaSeat(undefined)).toBe(false);
  });
});

describe("TV texture binding", () => {
  test("a shared screen track plays muted into a VideoTexture; dispose lets go of it", () => {
    const video = {
      muted: false,
      playsInline: false,
      autoplay: false,
      srcObject: null as unknown,
      videoWidth: 0,
      videoHeight: 0,
      played: 0,
      paused: false,
      play() {
        this.played += 1;
        return Promise.resolve();
      },
      pause() {
        this.paused = true;
      },
      addEventListener() {},
      removeEventListener() {},
    };
    const track = { id: "screen", kind: "video" } as unknown as MediaStreamTrack;
    const stream = { tracks: [track] };
    const binding = bindTvTexture(track, {
      makeVideo: () => video as unknown as HTMLVideoElement,
      makeStream: (t) => {
        expect(t).toBe(track);
        return stream as unknown as MediaStream;
      },
    });
    expect(binding.texture).toBeInstanceOf(VideoTexture);
    expect(binding.texture.image as unknown).toBe(video);
    expect(video.srcObject).toBe(stream);
    expect(video.muted && video.playsInline && video.played === 1).toBe(true);
    expect(binding.aspect()).toBeCloseTo(16 / 9);
    video.videoWidth = 1000;
    video.videoHeight = 1000;
    expect(binding.aspect()).toBe(1);
    binding.dispose();
    expect(video.srcObject).toBeNull();
    expect(video.paused).toBe(true);
  });

  test("letterboxes the shared screen into the TV's glass", () => {
    expect(fitToScreen(16 / 9, 2, 1.125)).toEqual([2, 1.125]);
    const [w, h] = fitToScreen(4 / 3, 2, 1.125);
    expect(h).toBe(1.125);
    expect(w).toBeCloseTo(1.5);
    const [w2, h2] = fitToScreen(21 / 9, 2, 1.125);
    expect(w2).toBe(2);
    expect(h2).toBeCloseTo(2 / (21 / 9));
    expect(fitToScreen(Number.NaN, 2, 1.125)).toEqual([2, 1.125]);
  });
});
