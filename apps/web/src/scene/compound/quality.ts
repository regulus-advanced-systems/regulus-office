/**
 * Render detail for the compound (#186, SPEC §11). On a GPU the scene draws
 * everything: pooled tungsten lights, pipes, cable trays, lamps and clutter.
 * Where WebGL runs in software (SwiftShader, llvmpipe: no GPU, a locked-down
 * VM, CI) every vertex and pixel is CPU work, so the "low" tier drops the
 * point lights and the small fixtures and decor, and only draws what is near
 * the player. `?quality=low|high` overrides the detection.
 */
import { create } from "zustand";
import type { PieceId } from "../lair/kit.ts";
import type { PiecePlacement } from "../lair/placements.ts";

export type Quality = "high" | "low";

export const useQualityStore = create<{ quality: Quality; set: (q: Quality) => void }>()((set) => ({
  quality: "high",
  set: (quality) => set({ quality }),
}));

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software/i;

/** The tier for a WebGL renderer string and the page's query. */
export function qualityFor(renderer: string, search: string): Quality {
  const asked = new URLSearchParams(search).get("quality");
  if (asked === "low" || asked === "high") return asked;
  return SOFTWARE.test(renderer) ? "low" : "high";
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

export function forQuality(items: PiecePlacement[], quality: Quality): PiecePlacement[] {
  return quality === "high" ? items : items.filter((p) => !LOW_DETAIL_SKIP.has(p.piece));
}

/** In the low tier nothing farther than this from the camera's target is drawn, metres. */
export const LOW_DRAW_DISTANCE = 34;

/** Detect the tier before the scene's canvas exists (antialiasing is fixed at context creation). */
export function detectQuality(search: string): Quality {
  if (typeof document === "undefined") return "high";
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const quality = qualityFor(gl ? rendererOf(gl) : "", search);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return quality;
  } catch {
    return qualityFor("", search);
  }
}
