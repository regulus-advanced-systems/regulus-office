/**
 * The official YouTube IFrame Player API (#47, research 01 §5): loaded once
 * from youtube.com when a YouTube track first plays, never proxied, never
 * downloaded. Only the calls the jukebox uses are typed.
 */

export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
}

export interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width?: number | string;
      height?: number | string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YouTubePlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number };
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const YOUTUBE_API_SRC = "https://www.youtube.com/iframe_api";

let loading: Promise<YouTubeApi> | null = null;

/** The API, loading its script on first use; rejects when it cannot load (offline). */
export function loadYouTubeApi(timeoutMs = 15_000): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YouTubeApi>((resolve, reject) => {
    const timer = setTimeout(() => {
      loading = null;
      reject(new Error("YouTube did not load"));
    }, timeoutMs);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      clearTimeout(timer);
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = YOUTUBE_API_SRC;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      loading = null;
      script.remove();
      reject(new Error("YouTube did not load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}
