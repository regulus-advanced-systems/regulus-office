/**
 * The lobby jukebox's panel (#47, SPEC §9.4 "queue UI"): now playing with
 * its controls, up next, the library and adding music, plus the viewer's
 * own mute and (owners and admins) the office-wide jukebox volume. Opened
 * from the jukebox (click or `E`) or the HUD's now-playing strip; a modal,
 * so it is keyboard-operable and Escape closes it.
 */
import { IDLE_JUKEBOX, type JukeboxState, type JukeboxTrack } from "@regulus/protocol";
import { useCallback, useEffect, useId, useState } from "react";
import { useBuildingStore } from "../../state/building.ts";
import { useJukeboxStore } from "../../state/jukebox.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { FormAlert } from "../auth/AuthCard.tsx";
import { Modal } from "../components/Modal.tsx";
import { Switch } from "../components/Switch.tsx";
import { AddMusic } from "./AddMusic.tsx";
import { listTracks } from "./api.ts";
import { controlsFor } from "./model.ts";
import { NowPlaying } from "./NowPlaying.tsx";
import { Library, UpNext } from "./QueueAndLibrary.tsx";
import { type JukeboxSend, officeJukeboxSend, useJukeboxRejections } from "./send.ts";

const IDLE: JukeboxState = { ...IDLE_JUKEBOX, current: { ...IDLE_JUKEBOX.current }, queue: [] };

function useLibrary(): [JukeboxTrack[], boolean, () => void] {
  const [tracks, setTracks] = useState<JukeboxTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    void listTracks().then((res) => {
      setLoading(false);
      if (res.ok) setTracks(res.value);
    });
  }, []);
  useEffect(reload, []);
  return [tracks, loading, reload];
}

function OfficeVolume({ volume, send }: { volume: number; send: JukeboxSend }) {
  const id = useId();
  const [value, setValue] = useState(Math.round(volume * 100));
  useEffect(() => setValue(Math.round(volume * 100)), [volume]);
  return (
    <div className="rg-field">
      <label className="rg-field__label" htmlFor={id}>
        Jukebox volume for everyone <span className="rg-muted">({value}%)</span>
      </label>
      <input
        id={id}
        className="rg-range"
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => setValue(Number(e.currentTarget.value))}
        onPointerUp={() => send("jukebox.volume", { volume: value / 100 })}
        onKeyUp={() => send("jukebox.volume", { volume: value / 100 })}
      />
    </div>
  );
}

export function JukeboxPanel({ send = officeJukeboxSend }: { send?: JukeboxSend }) {
  const close = useJukeboxStore((s) => s.closePanel);
  const jukebox = useBuildingStore((s) => s.state?.jukebox ?? IDLE);
  const user = useSessionStore((s) => s.user);
  const muted = useUiStore((s) => s.settings.jukeboxMuted);
  const update = useUiStore((s) => s.updateSettings);
  const viewer = user ? { userId: user.id, role: user.role } : null;
  const controls = controlsFor(viewer, jukebox);
  const [tracks, loading, reload] = useLibrary();
  const [error, setError] = useJukeboxRejections();
  const guarded: JukeboxSend = (type, payload) => {
    setError(null);
    try {
      send(type, payload);
    } catch {
      setError("Not connected to the office yet. Try again in a moment.");
    }
  };

  return (
    <Modal open onClose={close} title="Jukebox" width={860} className="rg-modal--jukebox">
      <div className="rg-jukebox" data-testid="jukebox-panel">
        <div className="rg-jukebox__column">
          <NowPlaying jukebox={jukebox} controls={controls} send={guarded} />
          {error && <FormAlert>{error}</FormAlert>}
          <UpNext queue={jukebox.queue} viewer={viewer} send={guarded} />
          <section className="rg-jukebox__section" aria-label="Sound">
            <h3 className="rg-jukebox__heading">Sound</h3>
            <Switch
              checked={muted}
              onChange={(next) => update({ jukeboxMuted: next })}
              label="Mute the jukebox for me"
              hint="Louder in the lobby, faint in the corridors, silent deep in the rooms. Your office volume is in Settings."
            />
            {controls.manage && <OfficeVolume volume={jukebox.volume} send={guarded} />}
          </section>
        </div>
        <div className="rg-jukebox__column">
          <Library tracks={tracks} loading={loading} controls={controls} send={guarded} />
          {controls.use && (
            <AddMusic
              onAdded={(track) => {
                reload();
                guarded("jukebox.enqueue", { trackId: track.id });
              }}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
