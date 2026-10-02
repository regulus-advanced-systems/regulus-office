/**
 * The jukebox's sound on this page (#47), mounted once by the HUD: the
 * server clock (serverClock.ts), the file player (filePlayer.ts), the audio
 * unlock on the first gesture, and a check four times a second that steers
 * the player onto the server's playhead at the loudness the player's spot
 * in the compound calls for (the scene writes `useJukeboxStore.level`).
 * YouTube tracks play in their HUD panel instead (ui/jukebox/YouTubePanel).
 *
 * With `?stats`, `window.__regulusJukebox` reads the last sync (e2e probe).
 */
import type { BuildingState } from "@regulus/protocol";
import { useEffect } from "react";
import { getOfficeClient } from "../../net/index.ts";
import { useBuildingStore } from "../../state/building.ts";
import { useConnectionStore } from "../../state/connection.ts";
import { type JukeboxSync, useJukeboxStore } from "../../state/jukebox.ts";
import { useUiStore } from "../../state/ui.ts";
import { audioUnlocked, sharedAudioContext, unlockAudioOnGesture } from "../context.ts";
import { FilePlayer } from "./filePlayer.ts";
import { jukeboxGain } from "./jukeboxGain.ts";
import { createServerClock, officeClockLink, type ServerClock } from "./serverClock.ts";

/** How often the player is checked against the playhead, ms. */
export const SYNC_INTERVAL_MS = 250;

export interface JukeboxProbe {
  sync: JukeboxSync | null;
  /** Server time now, by this page's clock sync. */
  serverNow(): number;
  /** The `<audio>` element's position, ms (null without one). */
  elementMs(): number | null;
  level(): number;
  /** Where to stand to use the jukebox, compound metres. */
  stand(): { x: number; z: number } | null;
  /** Is the `<audio>` element playing? */
  playing(): boolean;
}

declare global {
  interface Window {
    /** The jukebox's sync on this page, only when `?stats` is set (#47 e2e). */
    __regulusJukebox?: JukeboxProbe;
  }
}

function currentJukebox(): BuildingState["jukebox"] | null {
  return useBuildingStore.getState().state?.jukebox ?? null;
}

let clockRef: ServerClock | null = null;

/** Server time by this page's clock sync (Date.now() before the playback hook mounts). */
export function serverNow(): number {
  return clockRef?.now() ?? Date.now();
}

export function useJukeboxPlayback(): void {
  useEffect(() => {
    const removeUnlock = unlockAudioOnGesture();
    let client: ReturnType<typeof getOfficeClient> | null = null;
    try {
      client = getOfficeClient();
    } catch {
      client = null;
    }
    const clock = client ? createServerClock({ link: officeClockLink(client) }) : null;
    clockRef = clock;
    const resync = useConnectionStore.subscribe((s, prev) => {
      if (s.status === "connected" && prev.status !== "connected") clock?.resync();
    });
    let element: HTMLAudioElement | null = null;
    const player = new FilePlayer({
      audio: sharedAudioContext,
      makeElement: () => {
        element = new Audio();
        return element;
      },
    });

    const check = () => {
      const jukebox = currentJukebox();
      if (!jukebox) return;
      const { settings } = useUiStore.getState();
      const local = useJukeboxStore.getState();
      const now = serverNow();
      const reading = player.update({
        entry: jukebox.current,
        playhead: {
          playing: jukebox.playing,
          startedAtServerMs: jukebox.startedAtServerMs,
          pausedAtMs: jukebox.pausedAtMs,
          durationMs: jukebox.current.durationMs,
        },
        gain: jukeboxGain({
          volume: settings.volume,
          muted: settings.jukeboxMuted,
          officeVolume: jukebox.volume,
          level: local.level,
        }),
        serverNow: now,
        unlocked: audioUnlocked(),
      });
      local.setSync(
        reading
          ? { ...reading, offsetMs: clock?.offset ?? 0, errorMs: clock?.error ?? Infinity }
          : null,
      );
    };
    const timer = setInterval(check, SYNC_INTERVAL_MS);
    // A change of track or of the playhead is acted on at once, not at the next check.
    const unsub = useBuildingStore.subscribe((s, prev) => {
      const a = s.state?.jukebox;
      const b = prev.state?.jukebox;
      if (!a || a === b) return;
      if (
        a.current.entryId !== b?.current.entryId ||
        a.playing !== b?.playing ||
        a.startedAtServerMs !== b?.startedAtServerMs
      )
        queueMicrotask(check);
    });

    if (new URLSearchParams(window.location.search).has("stats")) {
      window.__regulusJukebox = {
        get sync() {
          return useJukeboxStore.getState().sync;
        },
        serverNow,
        elementMs: () => (element ? element.currentTime * 1000 : null),
        level: () => useJukeboxStore.getState().level,
        stand: () => useJukeboxStore.getState().stand,
        playing: () => Boolean(element && !element.paused && element.readyState >= 2),
      };
    }
    return () => {
      clearInterval(timer);
      unsub();
      resync();
      removeUnlock();
      clock?.stop();
      if (clockRef === clock) clockRef = null;
      player.dispose();
      window.__regulusJukebox = undefined;
    };
  }, []);
}
