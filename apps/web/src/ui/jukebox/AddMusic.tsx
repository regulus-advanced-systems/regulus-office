/**
 * Adding music to the jukebox (#47): upload an audio file (its length is
 * read here first, the office checks the rest) or paste a YouTube link
 * (only its id is kept; it plays through YouTube's own player). Both land
 * in the library and are queued at once.
 */
import { JUKEBOX_LIMITS, type JukeboxTrack } from "@regulus/protocol";
import { type FormEvent, useId, useRef, useState } from "react";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Button } from "../components/Button.tsx";
import { addYouTube, measureDuration, uploadTrack } from "./api.ts";

const MB = Math.round(JUKEBOX_LIMITS.uploadMaxBytes / (1024 * 1024));

export function AddMusic({ onAdded }: { onAdded: (track: JukeboxTrack) => void }) {
  const ids = { file: useId(), title: useId(), youtube: useId() };
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"file" | "youtube" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [youtube, setYouTube] = useState("");
  const [title, setTitle] = useState("");

  const submitFile = async (event: FormEvent) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose an audio file first.");
      return;
    }
    setBusy("file");
    setError(null);
    const durationMs = await measureDuration(file);
    if (durationMs === null) {
      setBusy(null);
      setError("This browser cannot play that file, so the jukebox could not either.");
      return;
    }
    const res = await uploadTrack({ file, title: title.trim(), artist: "", durationMs });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (fileRef.current) fileRef.current.value = "";
    setTitle("");
    onAdded(res.value);
  };

  const submitYouTube = async (event: FormEvent) => {
    event.preventDefault();
    if (!youtube.trim()) return;
    setBusy("youtube");
    setError(null);
    const res = await addYouTube({ url: youtube.trim() });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setYouTube("");
    onAdded(res.value);
  };

  return (
    <section className="rg-jukebox__section rg-jukebox__add" aria-label="Add music">
      <h3 className="rg-jukebox__heading">Add music</h3>
      <form className="rg-jukebox__form" onSubmit={submitFile}>
        <div className="rg-field">
          <label className="rg-field__label" htmlFor={ids.file}>
            Audio file
          </label>
          <input
            id={ids.file}
            ref={fileRef}
            className="rg-input"
            type="file"
            accept="audio/*,.mp3,.ogg,.flac,.wav,.m4a,.webm"
          />
          <div className="rg-field__hint">
            Up to {MB} MB and 30 minutes. Only music you may share with the office.
          </div>
        </div>
        <div className="rg-field">
          <label className="rg-field__label" htmlFor={ids.title}>
            Title <span className="rg-muted">(optional)</span>
          </label>
          <input
            id={ids.title}
            className="rg-input"
            value={title}
            maxLength={JUKEBOX_LIMITS.titleMax}
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={busy !== null}>
          {busy === "file" ? "Uploading…" : "Upload and queue"}
        </Button>
      </form>
      <form className="rg-jukebox__form" onSubmit={submitYouTube}>
        <div className="rg-field">
          <label className="rg-field__label" htmlFor={ids.youtube}>
            YouTube link
          </label>
          <input
            id={ids.youtube}
            className="rg-input"
            inputMode="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={youtube}
            onChange={(e) => setYouTube(e.currentTarget.value)}
          />
          <div className="rg-field__hint">
            Plays in YouTube's own player in a panel, a second or two apart between listeners.
          </div>
        </div>
        <Button type="submit" variant="secondary" disabled={busy !== null || !youtube.trim()}>
          {busy === "youtube" ? "Adding…" : "Add and queue"}
        </Button>
      </form>
      {error && <FormAlert>{error}</FormAlert>}
    </section>
  );
}
