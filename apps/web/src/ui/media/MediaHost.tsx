/** Voice and the lounge TV (#48): the media session for this page and the TV's full-screen view. */
import { useMedia } from "../../media/useMedia.ts";
import { TvOverlay } from "./TvOverlay.tsx";
import "./media.css";

export function MediaHost() {
  useMedia();
  return <TvOverlay />;
}
