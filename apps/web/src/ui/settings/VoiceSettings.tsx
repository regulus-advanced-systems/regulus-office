/**
 * Settings → Display and sound → Voice (#48): which microphone, push-to-talk
 * (hold M) and how loud other people's voices are. Per browser
 * (settingsStorage.ts). Without media on this office it says so instead.
 */
import { useEffect, useId, useState } from "react";
import { selectMediaEnabled, useMediaStore } from "../../media/store.ts";
import { useUiStore } from "../../state/ui.ts";
import { Switch } from "../components/Switch.tsx";

interface Mic {
  deviceId: string;
  label: string;
}

/** The browser's microphones; labels stay empty until the page may use the mic once. */
export async function listMics(
  devices: Pick<MediaDevices, "enumerateDevices"> | undefined = globalThis.navigator?.mediaDevices,
): Promise<Mic[]> {
  if (!devices?.enumerateDevices) return [];
  try {
    return (await devices.enumerateDevices())
      .filter((d) => d.kind === "audioinput" && d.deviceId !== "default")
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch {
    return [];
  }
}

export function VoiceSettings() {
  const enabled = useMediaStore(selectMediaEnabled);
  const canPublish = useMediaStore((s) => s.status?.canPublish === true);
  const micOn = useMediaStore((s) => s.micOn);
  const settings = useUiStore((s) => s.settings);
  const update = useUiStore((s) => s.updateSettings);
  const [mics, setMics] = useState<Mic[]>([]);
  const micId = useId();
  const volumeId = useId();

  useEffect(() => {
    if (!enabled || !canPublish) return;
    let live = true;
    void listMics().then((list) => live && setMics(list));
    return () => {
      live = false;
    };
  }, [enabled, canPublish, micOn]);

  if (!enabled) {
    return (
      <div className="rg-field" data-testid="voice-settings-off">
        <span className="rg-field__label">Voice and the lounge TV</span>
        <div className="rg-field__hint">
          Not set up on this office. An owner turns them on with{" "}
          <code>scripts/setup.sh --media</code> (see docs/deploy/media.md).
        </div>
      </div>
    );
  }

  return (
    <>
      {canPublish ? (
        <>
          <div className="rg-field">
            <label className="rg-field__label" htmlFor={micId}>
              Microphone
            </label>
            <select
              id={micId}
              className="rg-select"
              value={settings.micDeviceId}
              onChange={(e) => {
                const deviceId = e.currentTarget.value;
                update({ micDeviceId: deviceId });
                void useMediaStore.getState().controller?.switchMic(deviceId);
              }}
            >
              <option value="">Browser default</option>
              {mics.map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.label}
                </option>
              ))}
            </select>
            {mics.length > 0 && mics.every((m) => m.label.startsWith("Microphone ")) && (
              <div className="rg-field__hint">Turn your mic on once to see the devices' names.</div>
            )}
          </div>
          <div className="rg-field">
            <Switch
              checked={settings.pushToTalk}
              onChange={(next) => update({ pushToTalk: next })}
              label="Push to talk"
              hint="Your mic is live only while you hold M. Off: M mutes and unmutes."
            />
          </div>
        </>
      ) : (
        <div className="rg-field__hint">
          Viewers hear voices nearby and watch the TV, but do not talk or share.
        </div>
      )}
      <div className="rg-field">
        <label className="rg-field__label" htmlFor={volumeId}>
          Voices <span className="rg-muted">({Math.round(settings.voiceVolume * 100)}%)</span>
        </label>
        <input
          id={volumeId}
          className="rg-range"
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(settings.voiceVolume * 100)}
          onChange={(e) => update({ voiceVolume: Number(e.currentTarget.value) / 100 })}
        />
        <div className="rg-field__hint">
          People nearby, louder the closer they stand; on top of the volume above.
        </div>
      </div>
    </>
  );
}
