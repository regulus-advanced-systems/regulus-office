/**
 * A YouTube track on the jukebox (#47, research 01 §5): YouTube's own,
 * unmodified player in a HUD panel (an iframe cannot sit in the 3D scene
 * without being hidden or occluded, which the API terms forbid). Loose
 * sync: once a second it compares the player with the server's playhead
 * and re-seeks only beyond two seconds (drift.ts). Its volume follows the
 * same gain as the file player (office volume, mute, spatial level); the
 * first listener whose player knows the video's length reports it, so the
 * office can move on at the end. The viewer may close the panel, which
 * stops the video for them until the next one.
 */
import { jukeboxPosition } from "@regulus/protocol";
import { useEffect, useRef, useState } from "react";
import { audioUnlocked } from "../../audio/context.ts";
import { youtubeNeedsSeek } from "../../audio/jukebox/drift.ts";
import { jukeboxGain } from "../../audio/jukebox/jukeboxGain.ts";
import { serverNow } from "../../audio/jukebox/useJukeboxPlayback.ts";
import { getOfficeClient } from "../../net/index.ts";
import { useBuildingStore } from "../../state/building.ts";
import { useJukeboxStore } from "../../state/jukebox.ts";
import { useUiStore } from "../../state/ui.ts";
import { CloseButton } from "../components/CloseButton.tsx";
import { loadYouTubeApi, type YouTubePlayer } from "./youtube.ts";

const SYNC_MS = 1_000;

function reportDuration(trackId: string, seconds: number) {
  if (!(seconds > 0)) return;
  try {
    getOfficeClient().send("jukebox.duration", { trackId, durationMs: Math.round(seconds * 1000) });
  } catch {
    // Not connected: another listener will report it.
  }
}

/** Keep `player` on the server's playhead at the right volume. */
function steer(player: YouTubePlayer, playingState: number) {
  const jukebox = useBuildingStore.getState().state?.jukebox;
  if (!jukebox || jukebox.current.source !== "youtube") return;
  const { settings } = useUiStore.getState();
  const gain = jukeboxGain({
    volume: settings.volume,
    muted: settings.jukeboxMuted,
    officeVolume: jukebox.volume,
    level: useJukeboxStore.getState().level,
  });
  if (gain <= 0.001) player.mute();
  else {
    player.unMute();
    player.setVolume(Math.round(gain * 100));
  }
  const duration = player.getDuration();
  if (jukebox.current.durationMs === 0) reportDuration(jukebox.current.trackId, duration);
  const expected = jukeboxPosition(
    {
      playing: jukebox.playing,
      startedAtServerMs: jukebox.startedAtServerMs,
      pausedAtMs: jukebox.pausedAtMs,
      durationMs: jukebox.current.durationMs || Math.round(duration * 1000),
    },
    serverNow(),
  );
  const drift = player.getCurrentTime() * 1000 - expected;
  if (!jukebox.playing) {
    player.pauseVideo();
    if (youtubeNeedsSeek(drift)) player.seekTo(expected / 1000, true);
    return;
  }
  if (youtubeNeedsSeek(drift)) player.seekTo(expected / 1000, true);
  if (player.getPlayerState() !== playingState && audioUnlocked()) player.playVideo();
}

export function YouTubePanel() {
  const current = useBuildingStore((s) => s.state?.jukebox.current ?? null);
  const closedFor = useJukeboxStore((s) => s.youtubeClosedFor);
  const closeFor = useJukeboxStore((s) => s.closeYouTube);
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const videoId = current?.source === "youtube" ? current.videoId : "";
  const entryId = current?.entryId ?? "";
  const open = videoId !== "" && closedFor !== entryId;

  useEffect(() => {
    if (!open || !host.current) return;
    setFailed(false);
    const mount = document.createElement("div");
    host.current.appendChild(mount);
    let player: YouTubePlayer | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let gone = false;
    loadYouTubeApi()
      .then((YT) => {
        if (gone) return;
        player = new YT.Player(mount, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0, origin: window.location.origin },
          events: {
            onReady: () => {
              if (!player || gone) return;
              steer(player, YT.PlayerState.PLAYING);
              timer = setInterval(() => player && steer(player, YT.PlayerState.PLAYING), SYNC_MS);
            },
            onError: () => setFailed(true),
          },
        });
      })
      .catch(() => {
        if (!gone) setFailed(true);
      });
    return () => {
      gone = true;
      if (timer) clearInterval(timer);
      try {
        player?.destroy();
      } catch {
        // Already gone.
      }
      mount.remove();
    };
  }, [open, videoId]);

  if (!open || !current) return null;
  return (
    <section className="rg-panel rg-youtube" aria-label="YouTube on the jukebox">
      <header className="rg-youtube__head">
        <span className="rg-youtube__title">
          <span className="rg-youtube__badge">YouTube</span> {current.title}
        </span>
        <CloseButton
          small
          label="Close the YouTube player (for you only)"
          onClick={() => closeFor(entryId)}
        />
      </header>
      <div className="rg-youtube__frame" ref={host}>
        {failed && (
          <p className="rg-youtube__failed">
            YouTube could not be reached from this browser. The rest of the office hears it.
          </p>
        )}
      </div>
    </section>
  );
}
