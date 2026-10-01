/**
 * Debug-scene options from the query string (#183) and the camera presets
 * the PR screenshots use: `?view=overview|corner|junction|door|console|
 * scaffold|pieces`, `door=open|closed`, `alarm=1`, `cut=0` (no cutaway),
 * `labels=0` (no catalogue labels), `stats=0` (no draw-call panel).
 */
import type { Vec3 } from "../geometry/builder.ts";

export interface CameraView {
  position: Vec3;
  target: Vec3;
  /** Where the stand-in player stands for the cutaway (default: the target). */
  focus?: Vec3;
}

export const VIEWS = {
  overview: { position: [22, 24, 36], target: [5, 0, 11] },
  corner: { position: [9.5, 6.5, 9.5], target: [2.6, 1, 2.2] },
  junction: { position: [16, 13, 30], target: [7, 0, 18.5] },
  door: { position: [10.5, 3.6, 19.5], target: [7, 1.3, 12.2], focus: [7, 0, 14.6] },
  console: { position: [5.6, 2.3, 3.6], target: [4.4, 1.0, 0.7] },
  scaffold: { position: [-1.5, 8, 16], target: [-6.5, 1.2, 6] },
  pieces: { position: [35, 22, 33], target: [35, 0, 9.5] },
  lounge: { position: [9, 5.5, 8.5], target: [13.6, 0.8, 3.6] },
} as const satisfies Record<string, CameraView>;

export type ViewId = keyof typeof VIEWS;

export interface ShowcaseOptions {
  view: ViewId;
  doorOpen: boolean;
  alarm: boolean;
  cutaway: boolean;
  labels: boolean;
  stats: boolean;
}

export function showcaseOptions(search: string): ShowcaseOptions {
  const q = new URLSearchParams(search);
  const view = q.get("view") ?? "overview";
  return {
    view: (Object.hasOwn(VIEWS, view) ? view : "overview") as ViewId,
    doorOpen: q.get("door") !== "closed",
    alarm: q.get("alarm") === "1",
    cutaway: q.get("cut") !== "0",
    labels: q.get("labels") !== "0",
    stats: q.get("stats") !== "0",
  };
}
