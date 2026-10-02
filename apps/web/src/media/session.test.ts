/** The media session against a fake LiveKit (#48): voices, the TV, permissions, sharing. */
import { beforeEach, describe, expect, test } from "bun:test";
import { type MediaHuman, MediaSession, type MediaView } from "./session.ts";
import { createMediaStore } from "./store.ts";
import {
  FakeRoom,
  fakeLiveKit,
  fakeTrack,
  RoomEvent,
  Source,
  screenTracks,
} from "./testing/fakeLiveKit.ts";
import type { VoiceOutput } from "./voiceOutput.ts";

function recordingOutput() {
  const gains = new Map<string, number>();
  const attached = new Map<string, MediaStreamTrack>();
  let master = 1;
  const out: VoiceOutput = {
    attach: (id, t) => void attached.set(id, t),
    detach: (id) => void attached.delete(id),
    setGain: (id, g) => void gains.set(id, g),
    setMaster: (l) => {
      master = l;
    },
    ids: () => [...attached.keys()],
    gainOf: (id) => gains.get(id) ?? null,
    dispose: () => attached.clear(),
  };
  return { out, gains, attached, master: () => master };
}

const human = (sessionId: string, x: number, extra: Partial<MediaHuman> = {}): MediaHuman => ({
  sessionId,
  x,
  z: 0,
  roomId: "lobby",
  operationId: "lobby",
  sharingScreen: false,
  ...extra,
});

const view = (others: MediaHuman[], extra: Partial<MediaView> = {}): MediaView => ({
  self: human("self", 0),
  others,
  lobbyId: "lobby",
  watchTv: true,
  voiceLevel: 0.8,
  pushToTalk: false,
  ...extra,
});

let share: { answer: boolean; asked: number; released: number };

async function connected(options: { refuseScreen?: boolean } = {}) {
  const store = createMediaStore();
  const output = recordingOutput();
  share = { answer: true, asked: 0, released: 0 };
  const session = new MediaSession({
    lk: fakeLiveKit(options),
    token: async () => ({
      ok: true,
      token: {
        url: "wss://office.example/livekit",
        token: "token:self",
        room: "office",
        identity: "self",
        expiresAt: Date.now() + 600_000,
        grants: {
          canSubscribe: true,
          canPublish: true,
          canPublishSources: ["microphone", "screen_share", "screen_share_audio"],
          canPublishData: false,
          canUpdateOwnMetadata: false,
        },
      },
    }),
    store,
    output: output.out,
    requestShare: async () => {
      share.asked += 1;
      return share.answer;
    },
    releaseShare: () => {
      share.released += 1;
    },
    micDeviceId: () => "",
  });
  await session.connect();
  const room = FakeRoom.last as FakeRoom;
  return { session, store, output, room };
}

beforeEach(() => {
  FakeRoom.failConnect = false;
  screenTracks.length = 0;
});

describe("media session (#48)", () => {
  test("connects with the office's token, never auto-subscribing", async () => {
    const { store, room } = await connected();
    expect(room.connectedWith?.url).toBe("wss://office.example/livekit");
    expect(room.connectedWith?.token).toBe("token:self");
    expect(room.connectedWith?.opts).toEqual({ autoSubscribe: false });
    expect(store.getState().connection).toBe("connected");
  });

  test("a refused token or an unreachable server is a clear failure", async () => {
    const store = createMediaStore();
    const s = new MediaSession({
      lk: fakeLiveKit(),
      token: async () => ({ ok: false, status: 503 }),
      store,
      output: recordingOutput().out,
      requestShare: async () => false,
      releaseShare: () => undefined,
      micDeviceId: () => "",
    });
    await s.connect();
    expect(store.getState().connection).toBe("failed");
    expect(store.getState().error).toContain("not set up");
    FakeRoom.failConnect = true;
    const again = await connected().catch(() => null);
    expect(again?.store.getState().connection).toBe("failed");
  });

  test("hears the nearest voices at their spatial level; far ones are not received", async () => {
    const { session, room, output } = await connected();
    const near = room.join("near");
    const mid = room.join("mid");
    const far = room.join("far");
    const nearMic = near.publish(Source.Microphone, fakeTrack("near-mic"));
    const midMic = mid.publish(Source.Microphone, fakeTrack("mid-mic"));
    const farMic = far.publish(Source.Microphone, fakeTrack("far-mic"));
    session.tick(view([human("near", 1), human("mid", 6), human("far", 60)]));
    expect(nearMic.isDesired).toBe(true);
    expect(midMic.isDesired).toBe(true);
    expect(farMic.isDesired).toBe(false);
    expect(output.gains.get("near")).toBe(1);
    expect(output.gains.get("mid")).toBeGreaterThan(0);
    expect(output.gains.get("mid")).toBeLessThan(0.5);
    expect(output.gains.get("far")).toBe(0);
    expect(output.master()).toBe(0.8);

    room.deliver(near, nearMic);
    expect(output.attached.get("near")).toBe(nearMic.track?.mediaStreamTrack as MediaStreamTrack);
    room.emit(RoomEvent.TrackUnsubscribed, null, nearMic, near);
    expect(output.attached.has("near")).toBe(false);
  });

  test("only the sharer's screen is received, and only with the TV in range", async () => {
    const { session, room, store } = await connected();
    const ada = room.join("ada");
    const eve = room.join("eve");
    const adaScreen = ada.publish(Source.ScreenShare, fakeTrack("ada-screen", "video"));
    const eveScreen = eve.publish(Source.ScreenShare, fakeTrack("eve-screen", "video"));
    const others = [human("ada", 4, { sharingScreen: true }), human("eve", 4)];
    session.tick(view(others));
    expect(adaScreen.isDesired).toBe(true);
    expect(eveScreen.isDesired).toBe(false);
    room.deliver(ada, adaScreen);
    expect(store.getState().screen?.sessionId).toBe("ada");
    expect(store.getState().screen?.track).toBe(
      adaScreen.track?.mediaStreamTrack as MediaStreamTrack,
    );
    session.tick(view(others, { watchTv: false }));
    expect(adaScreen.isDesired).toBe(false);
    // The office says nobody shares: the TV goes blank whatever is published.
    session.tick(view([human("ada", 4), human("eve", 4)]));
    expect(store.getState().screen).toBeNull();
  });

  test("our voice is open to all in the lobby, only to our room inside a project room", async () => {
    const { session, room } = await connected();
    room.join("roommate");
    room.join("outsider");
    session.tick(view([human("roommate", 2), human("outsider", 2)]));
    expect(room.localParticipant.permissions.at(-1)).toEqual({ all: true, list: [] });
    const inRoom = { roomId: "op-1", operationId: "op-1" };
    session.tick(
      view([human("roommate", 2, inRoom), human("outsider", 20)], {
        self: human("self", 0, inRoom),
      }),
    );
    expect(room.localParticipant.permissions.at(-1)).toEqual({
      all: false,
      list: [
        { participantIdentity: "outsider", allowedTrackSids: [] },
        { participantIdentity: "roommate", allowAll: true },
      ],
    });
  });

  test("sharing: asks the office first; a refusal drops the capture", async () => {
    const { session, room, store } = await connected();
    share.answer = false;
    await session.startShare();
    expect(share.asked).toBe(1);
    expect(room.localParticipant.published).toEqual([]);
    expect(screenTracks[0]?.stopped).toBe(true);
    expect(store.getState().sharing).toBe("idle");

    share.answer = true;
    await session.startShare();
    expect(room.localParticipant.published.map((p) => p.source)).toEqual([Source.ScreenShare]);
    expect(store.getState().sharing).toBe("live");
    // The office still says we share: we see our own screen on the TV.
    session.tick(view([], { self: human("self", 0, { sharingScreen: true }) }));
    expect(store.getState().screen?.sessionId).toBe("self");

    // An admin took it off the TV: we stop publishing.
    session.tick(view([], { self: human("self", 0, { sharingScreen: false }) }));
    await Bun.sleep(0);
    expect(room.localParticipant.unpublished).toHaveLength(1);
    expect(store.getState().sharing).toBe("idle");
    expect(store.getState().error).toContain("taken off the TV");
  });

  test("stopping our share unpublishes and tells the office; a closed picker is no error", async () => {
    const { session, room, store } = await connected();
    await session.startShare();
    await session.stopShare();
    expect(room.localParticipant.unpublished).toHaveLength(1);
    expect(share.released).toBe(1);
    expect(store.getState().sharing).toBe("idle");

    const refused = await connected({ refuseScreen: true });
    await refused.session.startShare();
    expect(refused.store.getState().sharing).toBe("idle");
    expect(refused.store.getState().error).toBeNull();
  });

  test("mic: on, mute and the badge state; push-to-talk keeps it muted until held", async () => {
    const { session, room, store } = await connected();
    await session.setMic(true);
    expect(store.getState().micOn).toBe(true);
    expect(store.getState().voices.self?.mic).toBe("on");
    await session.setMic(false);
    expect(store.getState().voices.self?.mic).toBe("muted");

    await session.setMic(true);
    session.tick(view([], { pushToTalk: true }));
    await Bun.sleep(0);
    const mic = room.localParticipant.getTrackPublication(Source.Microphone);
    expect(mic?.isMuted).toBe(true);
    store.getState().setTalking(true);
    session.applyTalking();
    await Bun.sleep(0);
    expect(mic?.isMuted).toBe(false);

    room.localParticipant.micError = Object.assign(new Error("no"), { name: "NotAllowedError" });
    await session.setMic(true);
    expect(store.getState().error).toContain("blocked the microphone");
  });

  test("speaking levels come from LiveKit's active speakers", async () => {
    const { session, room, store } = await connected();
    const ada = room.join("ada");
    ada.publish(Source.Microphone, fakeTrack("ada-mic"));
    ada.isSpeaking = true;
    ada.audioLevel = 0.6;
    room.emit(RoomEvent.ActiveSpeakersChanged, [ada]);
    expect(store.getState().voices.ada).toEqual({ mic: "on", speaking: true, level: 0.6 });
    await session.dispose();
    expect(room.disconnected).toBe(true);
  });
});
