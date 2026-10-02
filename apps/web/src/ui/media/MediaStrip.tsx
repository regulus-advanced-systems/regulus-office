/**
 * Voice and the lounge TV in the HUD's corner row (#48): the connection
 * lamp, the mic (turn on, mute, unmute; push-to-talk shows "hold M"), and
 * the screen share (share, stop, or watch someone else's). Hidden entirely
 * when the office has no media set up; viewers see "listening".
 */

import { LOBBY_OPERATION_ID } from "@regulus/protocol";
import { selectMediaEnabled, useMediaStore } from "../../media/store.ts";
import { selectSelf, useBuildingStore } from "../../state/building.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";

export type MicLabel = "Mic on" | "Mute mic" | "Unmute mic" | "Hold M to talk" | "Talking";

/** The mic button's label for our state. Pure. */
export function micLabel(
  mic: "none" | "on" | "muted",
  pushToTalk: boolean,
  talking: boolean,
): MicLabel {
  if (pushToTalk) return talking ? "Talking" : "Hold M to talk";
  if (mic === "none") return "Mic on";
  return mic === "on" ? "Mute mic" : "Unmute mic";
}

const CONNECTION_TEXT = {
  off: "Voice off",
  connecting: "Connecting",
  connected: "Voice",
  reconnecting: "Reconnecting",
  failed: "Voice failed",
} as const;

export function MediaStrip() {
  const enabled = useMediaStore(selectMediaEnabled);
  const canPublish = useMediaStore((s) => s.status?.canPublish === true);
  const connection = useMediaStore((s) => s.connection);
  const error = useMediaStore((s) => s.error);
  const sharing = useMediaStore((s) => s.sharing);
  const talking = useMediaStore((s) => s.talking);
  const screen = useMediaStore((s) => s.screen);
  const sessionId = useBuildingStore((s) => s.sessionId);
  const mic = useMediaStore((s) => (sessionId ? (s.voices[sessionId]?.mic ?? "none") : "none"));
  const pushToTalk = useUiStore((s) => s.settings.pushToTalk);
  const sharerId = useBuildingStore((s) => {
    const humans = s.state?.humans ?? {};
    return Object.keys(humans).find((k) => humans[k]?.sharingScreen) ?? null;
  });
  const sharerName = useBuildingStore((s) =>
    sharerId ? (s.state?.humans[sharerId]?.displayName ?? "") : "",
  );
  const sharer = sharerId ? { id: sharerId, name: sharerName } : null;
  const inLobby = useBuildingStore((s) => selectSelf(s)?.operationId === LOBBY_OPERATION_ID);
  if (!enabled) return null;

  const media = () => useMediaStore.getState();
  const ready = connection === "connected";
  const mine = sharer !== null && sharer.id === sessionId;
  const label = micLabel(mic, pushToTalk, talking);
  return (
    <section className="rg-panel rg-media-strip" aria-label="Voice and lounge TV">
      <span
        className={`rg-lamp rg-media-strip__lamp is-${connection}${mic === "on" ? " is-live" : ""}`}
        aria-hidden="true"
      />
      <span className="rg-media-strip__text" data-testid="media-strip" title={error ?? undefined}>
        <span className="rg-media-strip__label">{CONNECTION_TEXT[connection]}</span>
        {error ? <span className="rg-media-strip__error"> {error}</span> : null}
      </span>
      {canPublish ? (
        <Button
          size="sm"
          variant={mic === "on" ? "secondary" : "ghost"}
          disabled={!ready}
          aria-pressed={mic === "on" || talking}
          title="Your microphone (M)"
          onMouseDown={() => pushToTalk && media().controller?.setTalking(true)}
          onMouseUp={() => pushToTalk && media().controller?.setTalking(false)}
          onMouseLeave={() => pushToTalk && talking && media().controller?.setTalking(false)}
          onClick={() => {
            if (pushToTalk) {
              if (mic === "none") void media().controller?.setMic(true);
              return;
            }
            void media().controller?.setMic(mic !== "on");
          }}
        >
          {label}
        </Button>
      ) : (
        <span className="rg-media-strip__note">Listening</span>
      )}
      {mine ? (
        <Button size="sm" variant="primary" onClick={() => void media().controller?.stopShare()}>
          Stop sharing
        </Button>
      ) : sharer && screen ? (
        <Button size="sm" variant="secondary" onClick={() => media().openTv()}>
          Watch {sharer.name}
        </Button>
      ) : canPublish && !sharer ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={!ready || sharing !== "idle" || !inLobby}
          title={inLobby ? "Put your screen on the lounge TV" : "Walk to the lobby to share"}
          onClick={() => void media().controller?.startShare()}
        >
          {sharing === "starting" ? "Sharing..." : "Share screen"}
        </Button>
      ) : null}
    </section>
  );
}
