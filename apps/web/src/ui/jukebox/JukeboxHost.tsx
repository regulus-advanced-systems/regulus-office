/**
 * HUD side of the lobby jukebox (#47): the sound itself (playback hook),
 * a now-playing strip (in the HUD's corner row) with the personal mute and a button to the panel
 * (so the jukebox is reachable by keyboard from anywhere), the panel, and
 * YouTube's player panel while a YouTube track plays. The panel owns the
 * keyboard while open.
 */
import { useEffect } from "react";
import { useJukeboxPlayback } from "../../audio/jukebox/useJukeboxPlayback.ts";
import { useBuildingStore } from "../../state/building.ts";
import { useJukeboxStore } from "../../state/jukebox.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { JukeboxPanel } from "./JukeboxPanel.tsx";
import { YouTubePanel } from "./YouTubePanel.tsx";
import "./jukebox.css";

export const JUKEBOX_OVERLAY = "jukebox";

/** Now playing, the personal mute and a way to the panel; sits with the corner buttons. */
export function JukeboxStrip() {
  const current = useBuildingStore((s) => s.state?.jukebox.current ?? null);
  const playing = useBuildingStore((s) => Boolean(s.state?.jukebox.playing));
  const muted = useUiStore((s) => s.settings.jukeboxMuted);
  const update = useUiStore((s) => s.updateSettings);
  const open = useJukeboxStore((s) => s.openPanel);
  const loaded = Boolean(current && current.entryId !== "");
  const label = loaded && current ? current.title : "quiet";
  return (
    <section className="rg-panel rg-jukebox-strip" aria-label="Jukebox">
      <span className={`rg-lamp rg-jukebox__lamp${playing ? " is-on" : ""}`} aria-hidden="true" />
      <span className="rg-jukebox-strip__text" data-testid="jukebox-strip">
        <span className="rg-jukebox-strip__label">Jukebox</span>{" "}
        <span className="rg-jukebox-strip__title">
          {label}
          {loaded && !playing ? " (paused)" : ""}
        </span>
      </span>
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={muted}
        title={muted ? "Unmute the jukebox (for you)" : "Mute the jukebox (for you)"}
        onClick={() => update({ jukeboxMuted: !muted })}
      >
        {muted ? "Unmute" : "Mute"}
      </Button>
      <Button size="sm" variant="secondary" aria-haspopup="dialog" onClick={open}>
        Open
      </Button>
    </section>
  );
}

export function JukeboxHost() {
  useJukeboxPlayback();
  const panelOpen = useJukeboxStore((s) => s.panelOpen);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  useEffect(() => {
    if (!panelOpen) return;
    openOverlay(JUKEBOX_OVERLAY);
    return () => closeOverlay(JUKEBOX_OVERLAY);
  }, [panelOpen, openOverlay, closeOverlay]);
  return (
    <>
      <YouTubePanel />
      {panelOpen && <JukeboxPanel />}
    </>
  );
}
