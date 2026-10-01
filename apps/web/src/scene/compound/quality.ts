/**
 * Render detail for the compound (#186, #190, SPEC §11): three presets.
 * - `high` (a discrete or Apple GPU): everything, with MSAA, six pooled
 *   tungsten lights, blob shadows and the alarm's red lights.
 * - `medium` (an integrated GPU, or a browser that hides its GPU): no MSAA
 *   (the costliest per-pixel item on an iGPU's shared memory) and three
 *   pooled lights; every fixture and piece of decor stays.
 * - `low` (WebGL in software: SwiftShader, llvmpipe; no GPU, a locked-down
 *   VM, CI): every vertex and pixel is CPU work, so it also drops the point
 *   lights, blob shadows, the mountain and the small fixtures and decor,
 *   draws only what is near the player and renders at a reduced
 *   resolution scale.
 * The tier is picked from the WebGL renderer string, can be changed in
 * Settings (Graphics), and `?quality=low|medium|high` overrides both.
 */
import { create } from "zustand";
import type { PieceId } from "../lair/kit.ts";
import type { PiecePlacement } from "../lair/placements.ts";

export type Quality = "high" | "medium" | "low";
export const QUALITIES: readonly Quality[] = ["low", "medium", "high"];
/** The Settings choice: a preset, or the one detected from the GPU. */
export type QualitySetting = Quality | "auto";

export interface QualityPreset {
  /** MSAA (fixed when the WebGL context is made, so a change remounts the canvas). */
  antialias: boolean;
  /** Pooled tungsten point lights round the player (0: none). */
  lampLights: number;
  /** The blast door's two red alarm lights. */
  alarmLights: boolean;
  blobShadows: boolean;
  /** The rock mass round the compound (outside/Mountain.tsx). */
  mountain: boolean;
  /** Leave out LOW_DETAIL_SKIP's fixtures and decor everywhere (not only at the overview). */
  dropDecor: boolean;
  /** Only draw rooms and corridors within this many metres of the player; null: no limit. */
  drawDistance: number | null;
  /** The beach drawn unlit, light baked in, with a smaller plain sea. */
  liteOutside: boolean;
  /** Floor tiles as flat quads (lair/lite.ts) instead of their joints, stains and treads. */
  flatFloors: boolean;
  /** Drawing-buffer pixels per CSS pixel. */
  resolutionScale: number;
}

/** In the low tier nothing farther than this from the camera's target is drawn, metres. */
export const LOW_DRAW_DISTANCE = 34;

export const QUALITY_PRESETS: Readonly<Record<Quality, QualityPreset>> = {
  high: {
    antialias: true,
    lampLights: 6,
    alarmLights: true,
    blobShadows: true,
    mountain: true,
    dropDecor: false,
    drawDistance: null,
    liteOutside: false,
    flatFloors: false,
    resolutionScale: 1,
  },
  medium: {
    antialias: false,
    lampLights: 3,
    alarmLights: true,
    blobShadows: true,
    mountain: true,
    dropDecor: false,
    drawDistance: null,
    liteOutside: false,
    flatFloors: false,
    resolutionScale: 1,
  },
  low: {
    antialias: false,
    lampLights: 0,
    alarmLights: false,
    blobShadows: false,
    mountain: false,
    dropDecor: true,
    drawDistance: LOW_DRAW_DISTANCE,
    liteOutside: true,
    flatFloors: true,
    resolutionScale: 0.75,
  },
};

export function presetOf(quality: Quality): QualityPreset {
  return QUALITY_PRESETS[quality];
}

export const useQualityStore = create<{
  quality: Quality;
  /** What the GPU detection picked (shown as "Auto" in Settings). */
  detected: Quality;
  set: (q: Quality) => void;
  setDetected: (q: Quality) => void;
}>()((set) => ({
  quality: "high",
  detected: "high",
  set: (quality) => set({ quality }),
  setDetected: (detected) => set({ detected }),
}));

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software/i;
/** Integrated and mobile GPUs: Intel, AMD APUs, phone and tablet GPUs. */
const INTEGRATED =
  /intel|iris|uhd graphics|hd graphics|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|radeon \d{3}m|mali|adreno|powervr|videocore|apple a\d/i;

/** `?quality=` when it names a preset. */
export function askedQuality(search: string): Quality | null {
  const asked = new URLSearchParams(search).get("quality");
  return asked === "low" || asked === "medium" || asked === "high" ? asked : null;
}

/** The tier for a WebGL renderer string ("" when the browser hides it). */
export function tierFor(renderer: string): Quality {
  if (SOFTWARE.test(renderer)) return "low";
  // Intel's Arc cards are discrete.
  if (/\barc\b/i.test(renderer)) return "high";
  if (!renderer || INTEGRATED.test(renderer)) return "medium";
  return "high";
}

/** The tier for a WebGL renderer string and the page's query. */
export function qualityFor(renderer: string, search: string): Quality {
  return askedQuality(search) ?? tierFor(renderer);
}

/** The tier to draw: the query, else the Settings choice, else the detected one. */
export function effectiveQuality(
  detected: Quality,
  setting: QualitySetting | undefined,
  search: string,
): Quality {
  return askedQuality(search) ?? (setting && setting !== "auto" ? setting : detected);
}

/** The unmasked renderer of a WebGL context ("" when the browser hides it). */
export function rendererOf(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
}

/** Pieces the low tier leaves out: fixtures and decor that cost vertices but carry no function. */
export const LOW_DETAIL_SKIP: ReadonlySet<PieceId> = new Set<PieceId>([
  "pipe_run",
  "pipe_elbow",
  "cable_tray",
  "vent",
  "wall_lamp",
  "ceiling_light",
  "ceiling_beam",
  "hazard_strip",
  "wall_trim",
  "wall_clock",
  "pinboard",
  "poster",
  "poster_world_map",
  "poster_elements",
  "poster_blueprint",
  "poster_campaign",
  "wall_shelf",
  "desk_plant",
  "desk_mugs",
  "fruit_bowl",
  "desk_books",
  "seedling_tray",
  "cactus_tin",
  "rock_pile",
]);

/** The pieces to draw: all of them, or without the fixtures and decor when `drop`. */
export function forQuality(items: PiecePlacement[], drop: boolean): PiecePlacement[] {
  return drop ? items.filter((p) => !LOW_DETAIL_SKIP.has(p.piece)) : items;
}

/** The GPU's tier, detected before the scene's canvas exists (antialiasing is fixed then). */
export function detectTier(): Quality {
  if (typeof document === "undefined") return "high";
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const tier = tierFor(gl ? rendererOf(gl) : "");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return tier;
  } catch {
    return tierFor("");
  }
}
