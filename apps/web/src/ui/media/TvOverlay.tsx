/**
 * The lounge TV full screen (#48, SPEC §9.4): the shared screen in a large
 * dialog, opened by `E` or a click at the TV, the HUD's "Watch" button, or
 * by sitting on the lobby sofa (auto-focus: it opens when you sit down
 * while something is on, or when a share starts while you sit, and closes
 * when you stand up). The sharer can stop from here; an owner or admin can
 * take someone else's screen off the TV.
 */
import { mayStopAnyScreenShare } from "@regulus/protocol";
import { useEffect, useRef } from "react";
import { useMediaStore } from "../../media/store.ts";
import { isTvSofaSeat } from "../../scene/tv/spot.ts";
import { selectSelf, useBuildingStore } from "../../state/building.ts";
import { useSessionStore } from "../../state/session.ts";
import { useUiStore } from "../../state/ui.ts";
import { Button } from "../components/Button.tsx";
import { Modal } from "../components/Modal.tsx";

export const TV_OVERLAY = "tv";

/** Open the TV when we sit on the sofa with something on; close it when we get up. */
export function useSofaAutoFocus(): void {
  const seated = useBuildingStore((s) => isTvSofaSeat(selectSelf(s)?.seatId));
  const live = useMediaStore((s) => s.screen !== null);
  const opened = useRef(false);
  useEffect(() => {
    const media = useMediaStore.getState();
    if (seated && live && !media.tvOpen && !opened.current) {
      opened.current = true;
      media.openTv();
    } else if (!seated && opened.current) {
      opened.current = false;
      media.closeTv();
    } else if (!live) {
      opened.current = false;
    }
  }, [seated, live]);
}

export function TvOverlay() {
  useSofaAutoFocus();
  const open = useMediaStore((s) => s.tvOpen);
  const screen = useMediaStore((s) => s.screen);
  const close = useMediaStore((s) => s.closeTv);
  const sessionId = useBuildingStore((s) => s.sessionId);
  const sharerName = useBuildingStore((s) =>
    screen ? (s.state?.humans[screen.sessionId]?.displayName ?? "") : "",
  );
  const role = useSessionStore((s) => s.user?.role);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const video = useRef<HTMLVideoElement>(null);
  const showing = open && screen !== null;

  useEffect(() => {
    if (!showing) return;
    openOverlay(TV_OVERLAY);
    return () => closeOverlay(TV_OVERLAY);
  }, [showing, openOverlay, closeOverlay]);

  useEffect(() => {
    const el = video.current;
    if (!el || !screen) return;
    if (typeof MediaStream === "undefined") return;
    el.srcObject = new MediaStream([screen.track]);
    void el.play?.()?.catch?.(() => undefined);
    return () => {
      el.srcObject = null;
    };
  }, [screen, showing]);

  // Nothing on any more: the dialog goes.
  useEffect(() => {
    if (open && !screen) close();
  }, [open, screen, close]);

  if (!showing || !screen) return null;
  const mine = screen.sessionId === sessionId;
  const media = () => useMediaStore.getState();
  return (
    <Modal
      open
      onClose={close}
      title={`Lounge TV: ${mine ? "your screen" : `${sharerName || "someone"}'s screen`}`}
      width={1280}
      className="rg-modal--tv"
      footer={
        <>
          {mine ? (
            <Button variant="secondary" onClick={() => void media().controller?.stopShare()}>
              Stop sharing
            </Button>
          ) : role && mayStopAnyScreenShare(role) ? (
            <Button
              variant="secondary"
              onClick={() => media().controller?.stopShareOf(screen.sessionId)}
            >
              Take it off the TV
            </Button>
          ) : null}
          <Button variant="primary" onClick={close}>
            Close
          </Button>
        </>
      }
    >
      <video
        ref={video}
        className="rg-tv__video"
        data-testid="tv-video"
        muted
        playsInline
        autoPlay
        aria-label={`${sharerName || "Shared"} screen`}
      />
    </Modal>
  );
}
