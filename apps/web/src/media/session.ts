/**
 * This page's LiveKit connection (#48): proximity voice and the lounge TV.
 * Browser ↔ LiveKit only; the office minted the token and keeps who has the
 * TV (`HumanPresence.sharingScreen`), nothing else.
 *
 * - Voice: we receive only the nearest audible mics (voiceMix.ts, LiveKit
 *   `autoSubscribe: false` + `setSubscribed`), each through its own spatial
 *   gain (voiceOutput.ts). Our own mic is open to everyone while we stand in
 *   the lobby, corridors or special rooms, and only to the people in the
 *   same project room while we are in one: track subscription permissions,
 *   which the SFU enforces (protocol `voiceListeners`).
 * - The TV: we receive the screen of the human the office says is sharing,
 *   and only while the TV is in range or open; anyone else's screen track
 *   is never subscribed. Sharing asks the office first (`requestShare`).
 *
 * livekit-client is passed in (`lk`), loaded on demand, so an office
 * without media never downloads it and tests use a fake.
 */
import { voiceListeners } from "@regulus/protocol";
import type * as LiveKit from "livekit-client";
import type { StoreApi } from "zustand";
import type { TokenResult } from "./api.ts";
import type { MediaStore, VoiceState } from "./store.ts";
import { planVoices, type VoiceSource } from "./voiceMix.ts";
import type { VoiceOutput } from "./voiceOutput.ts";

export type LiveKitModule = Pick<
  typeof LiveKit,
  "Room" | "RoomEvent" | "Track" | "createLocalScreenTracks"
>;

/** One human as the session needs them (from the building state and the compound). */
export interface MediaHuman {
  sessionId: string;
  x: number;
  z: number;
  /** Compound room the human stands in; null in the corridors and outside. */
  roomId: string | null;
  /** The room the office placed them in (`operation.go`); the lobby id elsewhere. */
  operationId: string;
  sharingScreen: boolean;
}

export interface MediaView {
  self: MediaHuman | null;
  /** Everyone else connected. */
  others: readonly MediaHuman[];
  lobbyId: string;
  /** Receive the TV: it is in range or open full screen. */
  watchTv: boolean;
  /** Voice master level 0..1 (office volume × voice volume). */
  voiceLevel: number;
  /** Push-to-talk on: the mic stays muted unless the key is held. */
  pushToTalk: boolean;
}

export interface MediaSessionDeps {
  lk: LiveKitModule;
  token(): Promise<TokenResult>;
  store: StoreApi<MediaStore>;
  output: VoiceOutput;
  /** Send `screen.share.start` and wait for the office's answer. */
  requestShare(): Promise<boolean>;
  /** Send `screen.share.stop` (our own share). */
  releaseShare(): void;
  micDeviceId(): string;
}

const MIC_CAPTURE = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export class MediaSession {
  private room: LiveKit.Room | null = null;
  private view: MediaView | null = null;
  private permissionsKey = "";
  private shareTracks: LiveKit.LocalTrack[] = [];
  private disposed = false;

  constructor(private readonly deps: MediaSessionDeps) {}

  private get store() {
    return this.deps.store.getState();
  }

  async connect(): Promise<void> {
    const { lk } = this.deps;
    this.store.setConnection("connecting", null);
    const minted = await this.deps.token();
    if (this.disposed) return;
    if (!minted.ok) {
      this.store.setConnection("failed", tokenError(minted.status));
      return;
    }
    const room = new lk.Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    const E = lk.RoomEvent;
    const refresh = () => this.refresh();
    for (const event of [
      E.ParticipantConnected,
      E.ParticipantDisconnected,
      E.TrackPublished,
      E.TrackUnpublished,
      E.TrackMuted,
      E.TrackUnmuted,
      E.LocalTrackPublished,
      E.LocalTrackUnpublished,
      E.ActiveSpeakersChanged,
    ])
      room.on(event, refresh);
    room.on(E.TrackSubscribed, (track, pub, participant) => {
      if (pub.source === lk.Track.Source.Microphone)
        this.deps.output.attach(participant.identity, track.mediaStreamTrack);
      this.refresh();
    });
    room.on(E.TrackUnsubscribed, (_track, pub, participant) => {
      if (pub.source === lk.Track.Source.Microphone) this.deps.output.detach(participant.identity);
      this.refresh();
    });
    room.on(E.Reconnecting, () => this.store.setConnection("reconnecting"));
    room.on(E.Reconnected, () => this.store.setConnection("connected", null));
    room.on(E.Disconnected, () => {
      if (!this.disposed) this.store.setConnection("failed", "Voice disconnected.");
    });
    try {
      await room.connect(minted.token.url, minted.token.token, { autoSubscribe: false });
    } catch {
      if (!this.disposed)
        this.store.setConnection("failed", "Could not reach the voice server (LiveKit).");
      return;
    }
    if (this.disposed) {
      await room.disconnect();
      return;
    }
    this.store.setConnection("connected", null);
    this.permissionsKey = "";
    if (this.view) this.tick(this.view);
    this.refresh();
  }

  /** Apply where everyone is: voice levels, which tracks to receive, who may hear us. */
  tick(view: MediaView): void {
    this.view = view;
    const room = this.room;
    if (!room || this.store.connection !== "connected") return;
    const { Source } = this.deps.lk.Track;
    const self = view.self;
    const sharer = [self, ...view.others].find((h) => h?.sharingScreen)?.sessionId ?? null;

    // Voices: the nearest audible ones, at their spatial level.
    const byId = new Map(view.others.map((h) => [h.sessionId, h]));
    const sources: VoiceSource[] = [];
    const received = new Set<string>();
    for (const p of room.remoteParticipants.values()) {
      const h = byId.get(p.identity);
      const mic = p.getTrackPublication(Source.Microphone);
      if (mic?.isSubscribed) received.add(p.identity);
      if (h && mic) sources.push({ id: p.identity, x: h.x, z: h.z, roomId: h.roomId });
    }
    const plan = self
      ? planVoices(self, sources, { current: received })
      : { subscribe: new Set<string>(), gains: new Map<string, number>() };
    for (const p of room.remoteParticipants.values()) {
      const mic = p.getTrackPublication(Source.Microphone);
      const want = plan.subscribe.has(p.identity);
      if (mic && mic.isDesired !== want) mic.setSubscribed(want);
      this.deps.output.setGain(p.identity, plan.gains.get(p.identity) ?? 0);
      const screen = p.getTrackPublication(Source.ScreenShare);
      const watch = view.watchTv && p.identity === sharer;
      if (screen && screen.isDesired !== watch) screen.setSubscribed(watch);
    }
    this.deps.output.setMaster(view.voiceLevel);

    this.applyTalking();

    // The office took our screen off the TV (an admin), or we left: stop publishing it.
    if (this.store.sharing === "live" && self && !self.sharingScreen) {
      void this.unpublishShare();
      this.store.setError("Your screen was taken off the TV.");
    }

    this.applyPermissions(view);
    this.refresh();
  }

  /** Push-to-talk: our published mic is muted unless the key is held. */
  applyTalking(): void {
    const room = this.room;
    if (!room || !this.view?.pushToTalk) return;
    const mic = room.localParticipant.getTrackPublication(this.deps.lk.Track.Source.Microphone);
    const live = this.store.talking;
    if (mic && mic.isMuted === live) void (live ? mic.unmute() : mic.mute());
  }

  /** Track subscription permissions for what we publish (enforced by the SFU). */
  private applyPermissions(view: MediaView): void {
    const room = this.room;
    if (!room || !view.self) return;
    const listeners = voiceListeners(view.self, view.others, view.lobbyId);
    const screenSid =
      room.localParticipant.getTrackPublication(this.deps.lk.Track.Source.ScreenShare)?.trackSid ??
      "";
    const everyone = [...room.remoteParticipants.keys()].sort();
    const key =
      listeners === "all" ? "all" : `${listeners.join(",")}|${everyone.join(",")}|${screenSid}`;
    if (key === this.permissionsKey) return;
    this.permissionsKey = key;
    if (listeners === "all") {
      room.localParticipant.setTrackSubscriptionPermissions(true, []);
      return;
    }
    const near = new Set(listeners);
    room.localParticipant.setTrackSubscriptionPermissions(
      false,
      everyone.map((identity) =>
        near.has(identity)
          ? { participantIdentity: identity, allowAll: true }
          : { participantIdentity: identity, allowedTrackSids: screenSid ? [screenSid] : [] },
      ),
    );
  }

  /** Voices, our mic and the TV's track into the store. */
  private refresh(): void {
    const room = this.room;
    if (!room) return;
    const { Source } = this.deps.lk.Track;
    const voices: Record<string, VoiceState> = {};
    const all = [room.localParticipant, ...room.remoteParticipants.values()];
    for (const p of all) {
      const mic = p.getTrackPublication(Source.Microphone);
      voices[p.identity] = {
        mic: !mic ? "none" : mic.isMuted ? "muted" : "on",
        speaking: p.isSpeaking && Boolean(mic && !mic.isMuted),
        level: p.isSpeaking ? p.audioLevel : 0,
      };
    }
    this.store.setVoices(voices);
    this.store.setMicOn(Boolean(room.localParticipant.getTrackPublication(Source.Microphone)));

    const view = this.view;
    const sharer = view
      ? [view.self, ...view.others].find((h) => h?.sharingScreen)?.sessionId
      : undefined;
    let screen: MediaStore["screen"] = null;
    const p = sharer
      ? sharer === room.localParticipant.identity
        ? room.localParticipant
        : room.remoteParticipants.get(sharer)
      : undefined;
    const track = p?.getTrackPublication(Source.ScreenShare)?.track?.mediaStreamTrack;
    if (sharer && track) {
      const current = this.store.screen;
      screen =
        current?.sessionId === sharer && current.track === track
          ? current
          : { sessionId: sharer, track };
    }
    this.store.setScreen(screen);
  }

  /** Publish our mic (the browser asks the first time), or mute/unmute it. */
  async setMic(on: boolean): Promise<void> {
    const room = this.room;
    if (!room) return;
    try {
      const deviceId = this.deps.micDeviceId();
      await room.localParticipant.setMicrophoneEnabled(on, {
        ...MIC_CAPTURE,
        ...(deviceId ? { deviceId } : {}),
      });
      this.store.setError(null);
    } catch (err) {
      this.store.setError(micError(err));
    }
    this.refresh();
  }

  async switchMic(deviceId: string): Promise<void> {
    await this.room?.switchActiveDevice("audioinput", deviceId).catch(() => undefined);
  }

  /** Pick a screen (inside the click's gesture), ask the office, then put it on the TV. */
  async startShare(): Promise<void> {
    const room = this.room;
    if (!room || this.store.sharing !== "idle") return;
    this.store.setSharing("starting");
    let tracks: LiveKit.LocalTrack[];
    try {
      tracks = await this.deps.lk.createLocalScreenTracks({
        audio: false,
        contentHint: "detail",
        selfBrowserSurface: "exclude",
      });
    } catch (err) {
      this.store.setSharing("idle");
      if ((err as Error)?.name !== "NotAllowedError")
        this.store.setError("Could not capture the screen.");
      return;
    }
    const granted = await this.deps.requestShare();
    if (!granted || this.disposed || this.room !== room) {
      for (const t of tracks) t.stop();
      this.store.setSharing("idle");
      return;
    }
    const { Source } = this.deps.lk.Track;
    this.shareTracks = tracks;
    for (const t of tracks) {
      // The browser's own "Stop sharing" button ends the track.
      t.mediaStreamTrack.addEventListener("ended", () => void this.stopShare());
      await room.localParticipant.publishTrack(t, {
        source: t.kind === "video" ? Source.ScreenShare : Source.ScreenShareAudio,
      });
    }
    this.store.setSharing("live");
    this.permissionsKey = "";
    if (this.view) this.applyPermissions(this.view);
    this.refresh();
  }

  async stopShare(): Promise<void> {
    if (this.store.sharing === "idle") return;
    await this.unpublishShare();
    this.deps.releaseShare();
  }

  private async unpublishShare(): Promise<void> {
    const tracks = this.shareTracks;
    this.shareTracks = [];
    this.store.setSharing("idle");
    for (const t of tracks) {
      await this.room?.localParticipant.unpublishTrack(t, true).catch(() => undefined);
      t.stop();
    }
    this.refresh();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const room = this.room;
    this.room = null;
    for (const t of this.shareTracks) t.stop();
    this.shareTracks = [];
    this.deps.output.dispose();
    await room?.disconnect().catch(() => undefined);
  }
}

function tokenError(status: number): string {
  if (status === 503) return "Voice and the TV are not set up on this office.";
  if (status === 401) return "Your session ended. Sign in again.";
  if (status === 0) return "Could not reach the office.";
  return `The office refused a voice token (${status}).`;
}

function micError(err: unknown): string {
  const name = (err as Error)?.name;
  if (name === "NotAllowedError")
    return "The browser blocked the microphone. Allow it in the address bar, then try again.";
  if (name === "NotFoundError") return "No microphone found.";
  return "Could not start the microphone.";
}
