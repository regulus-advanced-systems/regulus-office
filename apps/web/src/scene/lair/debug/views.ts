/**
 * Debug-scene options from the query string (#183) and the camera presets
 * the PR screenshots use: `?view=overview|corner|junction|door|console|
 * scaffold|pieces|lounge|styles`, `style=ops_room|lab|workshop|war_room`
 * (the main room's decor), `door=open|closed`, `alarm=1`, `cut=0` (no cutaway),
 * `labels=0` (no catalogue labels), `stats=0` (no draw-call panel),
 * `henchmen=0` (no henchmen).
 */
import { DECOR_STYLES, type DecorStyle, isOneOf } from "@regulus/protocol";
import type { Vec3 } from "../geometry/builder.ts";

const isDecorStyle = isOneOf(DECOR_STYLES);

export interface CameraView {
  position: Vec3;
  target: Vec3;
  /** Where the stand-in player stands for the cutaway (default: the target). */
  focus?: Vec3;
}

export const VIEWS = {
  overview: { position: [28, 27, 44], target: [8, 0, 14] },
  corner: { position: [10, 6.2, 10.5], target: [2.8, 1, 2.6] },
  junction: { position: [19, 13, 36], target: [10, 0, 22.5] },
  door: { position: [13.5, 3.6, 23.5], target: [10, 1.3, 16.2], focus: [10, 0, 18.6] },
  console: { position: [13.6, 2.3, 3.9], target: [12.2, 1.0, 0.7] },
  scaffold: { position: [-1.5, 8, 16], target: [-6.5, 1.2, 6] },
  pieces: { position: [45.5, 33, 42], target: [45.5, 0, 10] },
  lounge: { position: [11.5, 5.5, 16.5], target: [15.6, 0.8, 10.6] },
  styles: { position: [21, 30, 14], target: [21, 0, -9] },
} as const satisfies Record<string, CameraView>;

export type ViewId = keyof typeof VIEWS;

export interface ShowcaseOptions {
  view: ViewId;
  /** Decor style of the main room. */
  style: DecorStyle;
  doorOpen: boolean;
  alarm: boolean;
  cutaway: boolean;
  labels: boolean;
  stats: boolean;
  /** Henchmen (#184) at desks, consoles, in the corridor and on the site. */
  henchmen: boolean;
}

export function showcaseOptions(search: string): ShowcaseOptions {
  const q = new URLSearchParams(search);
  const view = q.get("view") ?? "overview";
  const style = q.get("style") ?? "ops_room";
  return {
    view: (Object.hasOwn(VIEWS, view) ? view : "overview") as ViewId,
    style: isDecorStyle(style) ? style : "ops_room",
    doorOpen: q.get("door") !== "closed",
    alarm: q.get("alarm") === "1",
    cutaway: q.get("cut") !== "0",
    labels: q.get("labels") !== "0",
    stats: q.get("stats") !== "0",
    henchmen: q.get("henchmen") !== "0",
  };
}
