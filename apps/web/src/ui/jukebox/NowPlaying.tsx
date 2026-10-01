/**
 * "Now playing" in the jukebox panel (#47): the track, who queued it, a
 * position slider (keyboard: arrows step 5 s, Page keys 30 s) and the
 * buttons for what the viewer may do, with the reason when they may not.
 */
import { type JukeboxState, jukeboxPosition } from "@regulus/protocol";
import { useEffect, useId, useRef, useState } from "react";
import { serverNow } from "../../audio/jukebox/useJukeboxPlayback.ts";
import { useJukeboxStore } from "../../state/jukebox.ts";
import { Button } from "../components/Button.tsx";
import { addedLabel, type Controls, clock, syncLabel } from "./model.ts";
import type { JukeboxSend } from "./send.ts";

const SEEK_SETTLE_MS = 350;

function usePosition(jukebox: JukeboxState): number {
  const read = () =>
    jukeboxPosition(
      {
        playing: jukebox.playing,
        startedAtServerMs: jukebox.startedAtServerMs,
        pausedAtMs: jukebox.pausedAtMs,
        durationMs: jukebox.current.durationMs,
      },
      serverNow(),
    );
  const [position, setPosition] = useState(read);
  useEffect(() => {
    setPosition(read());
    if (!jukebox.playing) return;
    const id = setInterval(() => setPosition(read()), 500);
    return () => clearInterval(id);
  });
  return position;
}

export function NowPlaying({
  jukebox,
  controls,
  send,
}: {
  jukebox: JukeboxState;
  controls: Controls;
  send: JukeboxSend;
}) {
  const position = usePosition(jukebox);
  const sync = useJukeboxStore((s) => s.sync);
  const sliderId = useId();
  // Arrow keys and drags settle first: one seek goes out, not one per step.
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);
  const seek = (seconds: number) => {
    setSeekTo(seconds);
    clearTimeout(timer.current ?? undefined);
    timer.current = setTimeout(() => {
      send("jukebox.seek", { positionMs: seconds * 1000 });
      setSeekTo(null);
    }, SEEK_SETTLE_MS);
  };
  const { current } = jukebox;
  const loaded = current.entryId !== "";

  if (!loaded) {
    return (
      <section className="rg-jukebox__now" aria-label="Now playing">
        <p className="rg-jukebox__idle">The jukebox is quiet.</p>
        {controls.use && (
          <Button variant="primary" onClick={() => send("jukebox.play", {})}>
            Play something
          </Button>
        )}
      </section>
    );
  }
  const duration = current.durationMs;
  const why = controls.current
    ? undefined
    : `Only ${current.addedByName || "who queued it"} or an admin can change this track.`;
  return (
    <section className="rg-jukebox__now" aria-label="Now playing">
      <div className="rg-jukebox__track">
        <span
          className={`rg-lamp rg-jukebox__lamp${jukebox.playing ? " is-on" : ""}`}
          aria-hidden="true"
        />
        <div className="rg-jukebox__track-text">
          <strong className="rg-jukebox__title" data-testid="jukebox-now-title">
            {current.title}
          </strong>
          <span className="rg-jukebox__meta">
            {current.artist || "Unknown artist"} ·{" "}
            {current.source === "youtube" ? "YouTube" : "file"} · {addedLabel(current)}
          </span>
        </div>
      </div>
      <div className="rg-jukebox__progress">
        <label className="rg-sr-only" htmlFor={sliderId}>
          Position in “{current.title}”
        </label>
        <span className="rg-jukebox__time">{clock(position)}</span>
        <input
          id={sliderId}
          className="rg-range rg-jukebox__seek"
          type="range"
          min={0}
          max={Math.max(1, Math.round(duration / 1000))}
          step={5}
          value={seekTo ?? Math.round(position / 1000)}
          disabled={!controls.current || duration === 0}
          aria-valuetext={`${clock((seekTo ?? position / 1000) * 1000)} of ${clock(duration)}`}
          onChange={(e) => seek(Number(e.currentTarget.value))}
        />
        <span className="rg-jukebox__time">{duration > 0 ? clock(duration) : "--:--"}</span>
      </div>
      <div className="rg-jukebox__buttons">
        {jukebox.playing ? (
          <Button
            variant="secondary"
            disabled={!controls.current}
            title={why}
            onClick={() => send("jukebox.pause", {})}
          >
            Pause
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!controls.current}
            title={why}
            onClick={() => send("jukebox.play", {})}
          >
            Play
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={!controls.current}
          title={why}
          onClick={() => send("jukebox.skip", {})}
        >
          Skip
        </Button>
        <span className="rg-jukebox__sync" role="status">
          {current.source === "file"
            ? syncLabel(sync)
            : "YouTube plays in its own panel, loosely in step."}
        </span>
      </div>
      {!controls.current && controls.use && <p className="rg-field__hint">{why}</p>}
    </section>
  );
}
