/**
 * The jukebox panel's lists (#47): "Up next" (the queue, with Remove for
 * whoever may) and the library (bundled tracks with their CC-BY credit,
 * uploads and YouTube links, each with Queue).
 */
import type { JukeboxQueueEntry, JukeboxTrack } from "@regulus/protocol";
import { Button } from "../components/Button.tsx";
import { addedLabel, type Controls, clock, mayRemove, type Viewer } from "./model.ts";
import type { JukeboxSend } from "./send.ts";

export function UpNext({
  queue,
  viewer,
  send,
}: {
  queue: readonly JukeboxQueueEntry[];
  viewer: Viewer | null;
  send: JukeboxSend;
}) {
  return (
    <section className="rg-jukebox__section" aria-label="Up next">
      <h3 className="rg-jukebox__heading">
        Up next <span className="rg-jukebox__count">{queue.length}</span>
      </h3>
      {queue.length === 0 ? (
        <p className="rg-jukebox__empty">Nothing queued. Pick a track below.</p>
      ) : (
        <ol className="rg-jukebox__list" data-testid="jukebox-queue">
          {queue.map((entry) => (
            <li key={entry.entryId} className="rg-jukebox__row">
              <div className="rg-jukebox__row-text">
                <strong>{entry.title}</strong>
                <span className="rg-jukebox__meta">
                  {entry.artist || "Unknown artist"} · {clock(entry.durationMs || Number.NaN)} ·{" "}
                  {addedLabel(entry)}
                </span>
              </div>
              {mayRemove(viewer, entry) && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Take “${entry.title}” off the queue`}
                  onClick={() => send("jukebox.remove", { entryId: entry.entryId })}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function Library({
  tracks,
  loading,
  controls,
  send,
}: {
  tracks: readonly JukeboxTrack[];
  loading: boolean;
  controls: Controls;
  send: JukeboxSend;
}) {
  return (
    <section className="rg-jukebox__section" aria-label="Library">
      <h3 className="rg-jukebox__heading">
        Library <span className="rg-jukebox__count">{tracks.length}</span>
      </h3>
      {loading && tracks.length === 0 ? (
        <p className="rg-jukebox__empty">Loading the records…</p>
      ) : (
        <ul className="rg-jukebox__list" data-testid="jukebox-library">
          {tracks.map((t) => (
            <li key={t.id} className="rg-jukebox__row" data-track={t.id}>
              <div className="rg-jukebox__row-text">
                <strong>{t.title}</strong>
                <span className="rg-jukebox__meta">
                  {t.artist || "Unknown artist"} · {clock(t.durationMs || Number.NaN)} ·{" "}
                  {t.bundled
                    ? "bundled"
                    : t.source === "youtube"
                      ? "YouTube"
                      : `uploaded by ${t.addedByName || "someone"}`}
                </span>
                {t.attribution && <span className="rg-jukebox__credit">{t.attribution}</span>}
              </div>
              {controls.use && (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Queue “${t.title}”`}
                  onClick={() => send("jukebox.enqueue", { trackId: t.id })}
                >
                  Queue
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
