/**
 * The shared screen on the lounge TV (#48): a received LiveKit screen track
 * → a hidden, muted <video> → a three.js VideoTexture on the TV's glass.
 * One binding per track; `dispose` stops drawing and releases the element
 * (the track itself belongs to LiveKit and is left alone).
 */
import { SRGBColorSpace, VideoTexture } from "three";

export interface TvBinding {
  readonly texture: VideoTexture;
  readonly video: HTMLVideoElement;
  readonly track: MediaStreamTrack;
  /** Width / height of the shared screen once known (16:9 until then). */
  aspect(): number;
  dispose(): void;
}

export interface TvBindingDeps {
  makeVideo?: () => HTMLVideoElement;
  makeStream?: (track: MediaStreamTrack) => MediaStream;
}

export function bindTvTexture(track: MediaStreamTrack, deps: TvBindingDeps = {}): TvBinding {
  const video = (deps.makeVideo ?? (() => document.createElement("video")))();
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = (deps.makeStream ?? ((t) => new MediaStream([t])))(track);
  void video.play?.()?.catch?.(() => undefined);
  const texture = new VideoTexture(video);
  texture.colorSpace = SRGBColorSpace;
  return {
    texture,
    video,
    track,
    aspect: () =>
      video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9,
    dispose() {
      texture.dispose();
      video.pause?.();
      video.srcObject = null;
    },
  };
}

/**
 * Scale (x, y) of a `w × h` picture inside a `screenW × screenH` screen,
 * letterboxed so the shared screen keeps its aspect ratio.
 */
export function fitToScreen(aspect: number, screenW: number, screenH: number): [number, number] {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  return a >= screenW / screenH ? [screenW, screenW / a] : [screenH * a, screenH];
}
