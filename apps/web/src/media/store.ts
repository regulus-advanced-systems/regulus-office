/**
 * Voice and lounge TV state on this page (#48). Who shares the TV is the
 * BuildingRoom's (`HumanPresence.sharingScreen`); this holds what LiveKit
 * tells this page: the connection, each participant's mic and speaking
 * level (keyed by LiveKit identity = building session id), our own mic,
 * the screen track the TV shows, and whether the TV is open full screen.
 * The scene reads levels with `getState()` in its frame loop, so speaking
 * never re-renders React.
 */
import type { MediaStatus } from "@regulus/protocol";
import { create, type StateCreator } from "zustand";
import { createStore } from "zustand/vanilla";

export type MediaConnection = "off" | "connecting" | "connected" | "reconnecting" | "failed";

export interface VoiceState {
  /** No mic published, a live mic, or a published mic that is muted. */
  mic: "none" | "on" | "muted";
  speaking: boolean;
  /** 0..1 from LiveKit's active speaker updates. */
  level: number;
}

export const SILENT: VoiceState = { mic: "none", speaking: false, level: 0 };

/** What the HUD and settings can ask of the media session (useMedia installs it). */
export interface MediaController {
  /** Turn the mic on (asks the browser the first time) or off. */
  setMic(on: boolean): Promise<void>;
  /** Push-to-talk: talk while held. */
  setTalking(held: boolean): void;
  /** Pick the screen and put it on the lounge TV. */
  startShare(): Promise<void>;
  stopShare(): Promise<void>;
  /** An owner/admin takes someone else's screen off the TV. */
  stopShareOf(sessionId: string): void;
  /** Use another microphone (settings). */
  switchMic(deviceId: string): Promise<void>;
}

export interface MediaStore {
  /** From the office; null until asked. */
  status: MediaStatus | null;
  connection: MediaConnection;
  /** Last problem worth telling the human (mic blocked, share refused...). */
  error: string | null;
  /** Keyed by session id (our own included once we publish). */
  voices: Record<string, VoiceState>;
  /** Our mic is published (on or muted). */
  micOn: boolean;
  /** Push-to-talk key held. */
  talking: boolean;
  /** The screen the TV shows: the sharer's session and the track (null: nothing on). */
  screen: { sessionId: string; track: MediaStreamTrack } | null;
  /** Our own share: being picked / waiting for the office, or live. */
  sharing: "idle" | "starting" | "live";
  /** The TV full screen on the HUD (sitting on the sofa, or `E` at the TV). */
  tvOpen: boolean;
  controller: MediaController | null;

  setStatus(status: MediaStatus | null): void;
  setConnection(connection: MediaConnection, error?: string | null): void;
  setError(error: string | null): void;
  setVoices(voices: Record<string, VoiceState>): void;
  setMicOn(on: boolean): void;
  setTalking(held: boolean): void;
  setScreen(screen: MediaStore["screen"]): void;
  setSharing(sharing: MediaStore["sharing"]): void;
  openTv(): void;
  closeTv(): void;
  setController(controller: MediaController | null): void;
  reset(): void;
}

const INITIAL = {
  status: null,
  connection: "off" as MediaConnection,
  error: null,
  voices: {},
  micOn: false,
  talking: false,
  screen: null,
  sharing: "idle" as const,
  tvOpen: false,
  controller: null,
};

const creator: StateCreator<MediaStore> = (set) => ({
  ...INITIAL,
  setStatus: (status) => set({ status }),
  setConnection: (connection, error) =>
    set((s) => ({ connection, error: error === undefined ? s.error : error })),
  setError: (error) => set({ error }),
  setVoices: (voices) => set({ voices }),
  setMicOn: (micOn) => set({ micOn }),
  setTalking: (talking) => set({ talking }),
  setScreen: (screen) => set((s) => (s.screen === screen ? s : { screen })),
  setSharing: (sharing) => set({ sharing }),
  openTv: () => set({ tvOpen: true }),
  closeTv: () => set({ tvOpen: false }),
  setController: (controller) => set({ controller }),
  reset: () => set({ ...INITIAL }),
});

export const useMediaStore = create<MediaStore>()(creator);

/** A separate store (tests). */
export function createMediaStore() {
  return createStore<MediaStore>()(creator);
}

/** Media is set up on this office (the HUD shows voice and the TV share). */
export function selectMediaEnabled(s: Pick<MediaStore, "status">): boolean {
  return s.status?.enabled === true;
}

/** The voice of one participant (silent when unknown). */
export function voiceOf(sessionId: string | null | undefined): VoiceState {
  if (!sessionId) return SILENT;
  return useMediaStore.getState().voices[sessionId] ?? SILENT;
}
