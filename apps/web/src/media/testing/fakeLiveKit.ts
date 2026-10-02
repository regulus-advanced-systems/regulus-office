/**
 * A stand-in for livekit-client (#48 tests): rooms, participants and track
 * publications with just what media/session.ts uses, and handles to drive
 * them (add a participant, publish, subscribe, emit events).
 */
import type { LiveKitModule } from "../session.ts";

export const Source = {
  Camera: "camera",
  Microphone: "microphone",
  ScreenShare: "screen_share",
  ScreenShareAudio: "screen_share_audio",
  Unknown: "unknown",
} as const;

const EVENTS = [
  "ParticipantConnected",
  "ParticipantDisconnected",
  "TrackPublished",
  "TrackUnpublished",
  "TrackSubscribed",
  "TrackUnsubscribed",
  "TrackMuted",
  "TrackUnmuted",
  "LocalTrackPublished",
  "LocalTrackUnpublished",
  "ActiveSpeakersChanged",
  "Reconnecting",
  "Reconnected",
  "Disconnected",
] as const;
export const RoomEvent = Object.fromEntries(
  EVENTS.map((e) => [e, e.charAt(0).toLowerCase() + e.slice(1)]),
) as Record<(typeof EVENTS)[number], string>;

let sid = 0;

export class FakePub {
  trackSid = `TR_${++sid}`;
  isMuted = false;
  isDesired = false;
  track: { mediaStreamTrack: MediaStreamTrack } | undefined;
  constructor(
    readonly source: string,
    track?: MediaStreamTrack,
  ) {
    if (track) this.track = { mediaStreamTrack: track };
  }
  get isSubscribed() {
    return this.isDesired && this.track !== undefined;
  }
  setSubscribed(on: boolean) {
    this.isDesired = on;
  }
  async mute() {
    this.isMuted = true;
  }
  async unmute() {
    this.isMuted = false;
  }
}

export class FakeParticipant {
  isSpeaking = false;
  audioLevel = 0;
  readonly pubs = new Map<string, FakePub>();
  constructor(public identity: string) {}
  getTrackPublication(source: string) {
    return this.pubs.get(source);
  }
  publish(source: string, track?: MediaStreamTrack) {
    const pub = new FakePub(source, track);
    this.pubs.set(source, pub);
    return pub;
  }
}

export class FakeLocalParticipant extends FakeParticipant {
  permissions: Array<{ all: boolean; list: unknown[] }> = [];
  published: Array<{ track: unknown; source: string }> = [];
  unpublished: unknown[] = [];
  micError: Error | null = null;
  setTrackSubscriptionPermissions(all: boolean, list: unknown[] = []) {
    this.permissions.push({ all, list });
  }
  async setMicrophoneEnabled(on: boolean) {
    if (this.micError) throw this.micError;
    const pub =
      this.pubs.get(Source.Microphone) ?? this.publish(Source.Microphone, fakeTrack("mic"));
    pub.isMuted = !on;
    return pub;
  }
  async publishTrack(track: { mediaStreamTrack: MediaStreamTrack }, opts: { source: string }) {
    this.published.push({ track, source: opts.source });
    return this.publish(opts.source, track.mediaStreamTrack);
  }
  async unpublishTrack(track: { mediaStreamTrack: MediaStreamTrack }) {
    this.unpublished.push(track);
    for (const [source, pub] of this.pubs)
      if (pub.track?.mediaStreamTrack === track.mediaStreamTrack) this.pubs.delete(source);
  }
}

export class FakeRoom {
  static last: FakeRoom | null = null;
  static failConnect = false;
  readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  readonly remoteParticipants = new Map<string, FakeParticipant>();
  readonly localParticipant: FakeLocalParticipant;
  connectedWith: { url: string; token: string; opts: unknown } | null = null;
  disconnected = false;
  constructor(readonly options: unknown) {
    this.localParticipant = new FakeLocalParticipant("self");
    FakeRoom.last = this;
  }
  on(event: string, cb: (...args: unknown[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb]);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    for (const cb of this.handlers.get(event) ?? []) cb(...args);
  }
  async connect(url: string, token: string, opts: unknown) {
    if (FakeRoom.failConnect) throw new Error("unreachable");
    this.connectedWith = { url, token, opts };
    this.localParticipant.identity = identityOf(token);
  }
  async disconnect() {
    this.disconnected = true;
  }
  async switchActiveDevice() {
    return true;
  }
  /** A remote participant joins. */
  join(identity: string) {
    const p = new FakeParticipant(identity);
    this.remoteParticipants.set(identity, p);
    this.emit(RoomEvent.ParticipantConnected, p);
    return p;
  }
  /** LiveKit delivers a track we asked for. */
  deliver(p: FakeParticipant, pub: FakePub) {
    this.emit(
      RoomEvent.TrackSubscribed,
      pub.track?.mediaStreamTrack && { mediaStreamTrack: pub.track.mediaStreamTrack },
      pub,
      p,
    );
  }
}

/** Tokens in these tests are just "token:<identity>". */
const identityOf = (token: string) => token.replace(/^token:/, "");

export function fakeTrack(id: string, kind = "audio"): MediaStreamTrack {
  const listeners: Array<() => void> = [];
  return {
    id,
    kind,
    stopped: false,
    stop() {
      (this as { stopped: boolean }).stopped = true;
    },
    addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    end: () => {
      for (const cb of listeners) cb();
    },
  } as unknown as MediaStreamTrack;
}

export const screenTracks: Array<{
  kind: string;
  mediaStreamTrack: MediaStreamTrack;
  stop(): void;
  stopped: boolean;
}> = [];

export function fakeLiveKit(options: { refuseScreen?: boolean } = {}): LiveKitModule {
  return {
    Room: FakeRoom,
    RoomEvent,
    Track: { Source },
    createLocalScreenTracks: async () => {
      if (options.refuseScreen)
        throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      const t = {
        kind: "video",
        mediaStreamTrack: fakeTrack("screen", "video"),
        stopped: false,
        stop() {
          this.stopped = true;
        },
      };
      screenTracks.push(t);
      return [t];
    },
  } as unknown as LiveKitModule;
}
