/**
 * Plays the jukebox's file tracks on this page (#47): one `<audio>` element
 * streaming the track from the office (Range requests), routed through the
 * shared AudioContext into a spatial gain (audio/spatial.ts), and steered
 * onto the server's playhead by drift.ts: settle, nudge the playback rate,
 * or re-seek. The pitch is not preserved while nudging: a 0.4 % resample
 * is inaudible, a time-stretch would warble.
 *
 * Nothing plays before the page's first gesture (audio/context.ts). When
 * the jukebox is inaudible here (muted, volume 0, too far away) for a few
 * seconds the element pauses, and picks the playhead up again when it is
 * audible; a re-seek on the way back costs nothing anyone can hear.
 */
import {
  type JukeboxQueueEntry,
  jukeboxAudioPath,
  jukeboxPosition,
  type PlayheadState,
} from "@regulus/protocol";
import type { JukeboxSync } from "../../state/jukebox.ts";
import { createSpatialGain, type SpatialGain } from "../spatial.ts";
import { correctDrift } from "./drift.ts";

export interface PlayerInput {
  entry: JukeboxQueueEntry;
  playhead: PlayheadState;
  /** Everything folded in: volume, mute, office level, spatial level. */
  gain: number;
  serverNow: number;
  unlocked: boolean;
}

export type Reading = Omit<JukeboxSync, "offsetMs" | "errorMs">;

/** Inaudible this long (ms) and the element pauses. */
const IDLE_PAUSE_MS = 3_000;
/** Starting guess and cap for how long a seek takes to resume playback, ms. */
const SEEK_LEAD_START_MS = 40;
const SEEK_LEAD_MAX_MS = 250;

export interface FilePlayerOptions {
  audio?: () => AudioContext | null;
  makeElement?: () => HTMLAudioElement;
  now?: () => number;
}

export class FilePlayer {
  private el: HTMLAudioElement | null = null;
  private voice: SpatialGain | null = null;
  private trackId = "";
  private silentSince = Number.POSITIVE_INFINITY;
  private seekLeadMs = SEEK_LEAD_START_MS;
  private seekStartedAt = 0;

  constructor(private readonly options: FilePlayerOptions = {}) {}

  private element(): HTMLAudioElement {
    if (this.el) return this.el;
    const el = this.options.makeElement?.() ?? new Audio();
    el.preload = "auto";
    el.preservesPitch = false;
    el.addEventListener("seeked", () => {
      if (this.seekStartedAt === 0) return;
      const took = this.clock() - this.seekStartedAt;
      this.seekStartedAt = 0;
      // Smoothed: one slow seek (a cold cache) does not set the lead for good.
      this.seekLeadMs = Math.min(SEEK_LEAD_MAX_MS, this.seekLeadMs * 0.7 + took * 0.3);
    });
    this.el = el;
    return el;
  }

  private clock(): number {
    return (this.options.now ?? (() => performance.now()))();
  }

  /** Route the element through the shared context once (createMediaElementSource is one-shot). */
  private route(el: HTMLAudioElement): void {
    if (this.voice) return;
    const ctx = this.options.audio?.() ?? null;
    if (!ctx) return;
    try {
      const source = ctx.createMediaElementSource(el);
      this.voice = createSpatialGain(ctx, ctx.destination);
      source.connect(this.voice.input);
    } catch {
      this.voice = null;
    }
  }

  private setGain(el: HTMLAudioElement, gain: number): void {
    if (this.voice) this.voice.set(gain);
    else el.volume = Math.min(1, Math.max(0, gain));
  }

  private seek(el: HTMLAudioElement, ms: number): void {
    this.seekStartedAt = this.clock();
    el.currentTime = Math.max(0, ms) / 1000;
    el.playbackRate = 1;
  }

  /** Stop and forget the track (nothing loaded, or a YouTube one). */
  stop(): void {
    const el = this.el;
    if (!el || this.trackId === "") return;
    el.pause();
    el.removeAttribute("src");
    el.load();
    this.trackId = "";
  }

  /** One check: load, play, pause or steer. Returns what it saw. */
  update(input: PlayerInput): Reading | null {
    const { entry, playhead, serverNow } = input;
    if (entry.entryId === "" || entry.source !== "file") {
      this.stop();
      return null;
    }
    if (!input.unlocked) return null;
    const el = this.element();
    this.route(el);
    this.setGain(el, input.gain);
    const reading = (action: Reading["action"], driftMs = 0): Reading => ({
      driftMs,
      rate: el.playbackRate,
      action,
      positionMs: jukeboxPosition(playhead, serverNow),
      serverAt: serverNow,
      trackId: entry.trackId,
    });

    if (this.trackId !== entry.trackId) {
      this.trackId = entry.trackId;
      el.src = jukeboxAudioPath(entry.trackId);
      el.load();
      this.silentSince = Number.POSITIVE_INFINITY;
    }
    // Not even the length known yet, or a seek still landing: nothing to measure.
    if (el.readyState < 1 || el.seeking) return reading("idle");

    const t = this.clock();
    if (input.gain <= 0.001) {
      if (this.silentSince === Number.POSITIVE_INFINITY) this.silentSince = t;
      if (!el.paused && t - this.silentSince > IDLE_PAUSE_MS) el.pause();
      if (el.paused) return reading("idle");
    } else this.silentSince = Number.POSITIVE_INFINITY;

    const expected = jukeboxPosition(playhead, serverNow);
    const atEnd = playhead.durationMs > 0 && expected >= playhead.durationMs - 50;
    if (!playhead.playing || atEnd) {
      if (!el.paused) el.pause();
      const drift = el.currentTime * 1000 - expected;
      if (!atEnd && Math.abs(drift) > 1) this.seek(el, expected);
      return reading("idle", drift);
    }
    if (el.paused) {
      this.seek(el, expected + this.seekLeadMs);
      void el.play().catch(() => undefined);
      return reading("seek");
    }
    const drift = el.currentTime * 1000 - expected;
    const fix = correctDrift(drift, el.playbackRate);
    if (fix.kind === "seek") this.seek(el, expected + this.seekLeadMs);
    else if (el.playbackRate !== fix.rate) el.playbackRate = fix.rate;
    return reading(fix.kind, drift);
  }

  dispose(): void {
    this.stop();
    this.voice?.dispose();
    this.voice = null;
    this.el = null;
  }
}
