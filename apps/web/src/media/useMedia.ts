/**
 * Voice and the lounge TV on this page (#48), mounted once by the HUD:
 * asks the office whether media is set up; if so, loads livekit-client,
 * connects with a token for our building session (again whenever that
 * session changes, or after a failure, with backoff), and five times a
 * second hands the session where everyone stands (view.ts). Installs the
 * controller the HUD and settings use, and the `M` key (mute toggle, or
 * hold to talk with push-to-talk).
 *
 * Without media nothing is loaded and the voice and share controls stay
 * hidden; the TV shows that screen share is off.
 */
import type { CommandRejected } from "@regulus/protocol";
import { useEffect } from "react";
import { getOfficeClient } from "../net/index.ts";
import { tvSpot } from "../scene/tv/spot.ts";
import { selectSelf, useBuildingStore } from "../state/building.ts";
import { useCompoundStore } from "../state/compound.ts";
import { usePlayerStore } from "../state/player.ts";
import { useUiStore } from "../state/ui.ts";
import { hotkeys, isEditableTarget } from "../ui/hotkeys/registry.ts";
import { fetchMediaStatus, fetchMediaToken } from "./api.ts";
import { type LiveKitModule, MediaSession } from "./session.ts";
import { type MediaController, useMediaStore } from "./store.ts";
import { mediaView } from "./view.ts";
import { createVoiceOutput, type VoiceOutput } from "./voiceOutput.ts";

export const MEDIA_TICK_MS = 200;

export interface MediaProbe {
  state(): Record<string, unknown>;
  /** Spatial gain of every voice received now, by session id. */
  gains(): Record<string, number>;
}

declare global {
  interface Window {
    /** Voice and TV state on this page, only when `?stats` is set (#48 checks). */
    __regulusMedia?: MediaProbe;
  }
}
/** How long to wait for the office to answer `screen.share.start`. */
const SHARE_ANSWER_MS = 5000;
const RETRY_MS = [3000, 10_000, 30_000, 60_000];

export const VOICE_HOTKEY = {
  id: "voice",
  key: "m",
  description: "Mute or unmute your microphone (with push-to-talk: hold to talk)",
  group: "Voice",
} as const;

function send(type: "screen.share.start" | "screen.share.stop", payload: { sessionId?: string }) {
  try {
    getOfficeClient().send(type, payload);
    return true;
  } catch {
    return false;
  }
}

/** Ask the office for the TV: resolves true once our presence shares, false on a refusal. */
function requestShare(): Promise<boolean> {
  return new Promise((resolve) => {
    let offRejected: (() => void) | undefined;
    const finish = (ok: boolean, reason?: string) => {
      clearTimeout(timer);
      offState();
      offRejected?.();
      if (!ok && reason) useMediaStore.getState().setError(reason);
      resolve(ok);
    };
    const offState = useBuildingStore.subscribe((s) => {
      if (selectSelf(s)?.sharingScreen) finish(true);
    });
    try {
      offRejected = getOfficeClient().onRejected((notice: CommandRejected) => {
        if (notice.type === "screen.share.start") finish(false, notice.reason);
      });
    } catch {
      // Not connected.
    }
    const timer = setTimeout(
      () => finish(false, "The office did not answer. Try again."),
      SHARE_ANSWER_MS,
    );
    if (selectSelf(useBuildingStore.getState())?.sharingScreen) finish(true);
    else if (!send("screen.share.start", {})) finish(false, "Not connected to the office.");
  });
}

async function loadLiveKit(): Promise<LiveKitModule> {
  return import("livekit-client");
}

export function useMedia(): void {
  const enabled = useMediaStore((s) => s.status?.enabled === true);
  const sessionId = useBuildingStore((s) => s.sessionId);

  // Is media set up here? Asked once per page (and again when our session changes).
  useEffect(() => {
    let live = true;
    void fetchMediaStatus().then((status) => {
      if (live) useMediaStore.getState().setStatus(status);
    });
    return () => {
      live = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    const store = useMediaStore;
    let session: MediaSession | null = null;
    let stopped = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let output: VoiceOutput | null = null;

    const view = () => {
      const world = useCompoundStore.getState().world;
      return mediaView({
        state: useBuildingStore.getState().state,
        sessionId,
        player: usePlayerStore.getState(),
        world,
        tv: tvSpot(world),
        tvOpen: store.getState().tvOpen,
        settings: useUiStore.getState().settings,
      });
    };

    const start = async () => {
      const lk = await loadLiveKit().catch(() => null);
      if (stopped) return;
      if (!lk) {
        store.getState().setConnection("failed", "Could not load the voice client.");
        return;
      }
      output = createVoiceOutput();
      session = new MediaSession({
        lk,
        token: () => fetchMediaToken(sessionId),
        store,
        output,
        requestShare,
        releaseShare: () => void send("screen.share.stop", {}),
        micDeviceId: () => useUiStore.getState().settings.micDeviceId,
      });
      session.tick(view());
      await session.connect();
      if (stopped) return;
      if (store.getState().connection === "connected") attempt = 0;
      else {
        const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 60_000;
        attempt += 1;
        const failed = session;
        session = null;
        await failed.dispose();
        retry = setTimeout(() => void start(), wait);
      }
    };

    const controller: MediaController = {
      setMic: async (on) => session?.setMic(on),
      setTalking: (held) => {
        if (store.getState().talking === held) return;
        store.getState().setTalking(held);
        session?.applyTalking();
      },
      startShare: async () => session?.startShare(),
      stopShare: async () => session?.stopShare(),
      stopShareOf: (target) => void send("screen.share.stop", { sessionId: target }),
      switchMic: async (deviceId) => session?.switchMic(deviceId),
    };
    store.getState().setController(controller);
    if (new URLSearchParams(window.location.search).has("stats")) {
      window.__regulusMedia = {
        state: () => {
          const s = store.getState();
          return {
            connection: s.connection,
            error: s.error,
            voices: s.voices,
            screen: s.screen?.sessionId ?? null,
            sharing: s.sharing,
            micOn: s.micOn,
            tvOpen: s.tvOpen,
          };
        },
        gains: () =>
          Object.fromEntries((output?.ids() ?? []).map((id) => [id, output?.gainOf(id) ?? 0])),
      };
    }
    void start();
    const timer = setInterval(() => session?.tick(view()), MEDIA_TICK_MS);
    // A failed connection turns back to "failed" on its own; a disconnect mid-call retries.
    const unsubConnection = store.subscribe((s, prev) => {
      if (s.connection === "failed" && prev.connection === "connected" && session && !stopped) {
        const dropped = session;
        session = null;
        void dropped.dispose().then(() => {
          if (!stopped) retry = setTimeout(() => void start(), RETRY_MS[0]);
        });
      }
    });

    return () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(retry);
      window.__regulusMedia = undefined;
      unsubConnection();
      void session?.dispose();
      session = null;
      const keepStatus = store.getState().status;
      store.getState().reset();
      store.getState().setStatus(keepStatus);
    };
  }, [enabled, sessionId]);

  // M: toggle the mic, or hold to talk.
  useEffect(() => {
    if (!enabled) return;
    let unregister: (() => void) | undefined;
    try {
      unregister = hotkeys.register(VOICE_HOTKEY);
    } catch {
      // Already registered (a second mount in tests).
    }
    const usable = (e: KeyboardEvent) =>
      e.key.toLowerCase() === VOICE_HOTKEY.key &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !isEditableTarget(e.target) &&
      useUiStore.getState().overlay === null;
    const down = (e: KeyboardEvent) => {
      if (!usable(e) || e.repeat) return;
      const media = useMediaStore.getState();
      if (!media.status?.canPublish || !media.controller) return;
      if (useUiStore.getState().settings.pushToTalk) {
        if (!media.micOn) void media.controller.setMic(true);
        media.controller.setTalking(true);
        return;
      }
      const live = media.micOn && media.voices[sessionId ?? ""]?.mic === "on";
      void media.controller.setMic(!live);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === VOICE_HOTKEY.key)
        useMediaStore.getState().controller?.setTalking(false);
    };
    const blur = () => useMediaStore.getState().controller?.setTalking(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      unregister?.();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [enabled, sessionId]);
}
