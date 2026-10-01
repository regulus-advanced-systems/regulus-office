/**
 * Cutaway walls (SPEC §9.2: "rooms are cutaways: no ceilings, and walls
 * between the camera and the player fade out"), for #186 to use.
 *
 * `applyCutaway(material, uniforms)` patches any built-in three material
 * (the lair's toon and glow materials) so that fragments lying between the
 * camera and a focus point (the player) and above the wall plinth are
 * removed with an ordered 4x4 dither. Dithering instead of alpha keeps the
 * walls opaque (no sorting, depth intact) and reads as a fade; the soft
 * edges of the region give a gradual falloff as the camera turns.
 *
 * The region is measured on the ground plane: a fragment is cut when it is
 * on the camera's side of the focus (`along` > margin) and within
 * `radius + spread * along` of the camera-focus line (a wedge that widens
 * toward the camera, so a whole near wall goes, not a keyhole). Everything below `keepBelow` stays, so a cut
 * wall leaves its plinth and steel rail as a clean trim. `cutawayAmount`
 * and `bayer4` are the same maths in TypeScript, so the rule is unit-tested.
 */
import { type Material, Vector3, type WebGLProgramParametersWithUniforms } from "three";
import { PLINTH_HEIGHT } from "./dimensions.ts";

export interface CutawayParams {
  /** Half-width of the cut region across the view line, metres. */
  radius: number;
  /** Width of the soft edges (along and across), metres. */
  soft: number;
  /** Heights below this are never cut (the plinth and its rail stay). */
  keepBelow: number;
  /** Distance in front of the focus (toward the camera) where cutting starts. */
  margin: number;
  /** How fast the region widens toward the camera (metres of radius per metre along). */
  spread: number;
}

export const CUTAWAY_DEFAULTS: CutawayParams = {
  radius: 3,
  soft: 0.6,
  keepBelow: PLINTH_HEIGHT + 0.06,
  margin: 0.5,
  spread: 0.5,
};

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * How much of a wall fragment at `p` to remove, 0 (keep) to 1 (gone), for a
 * camera at `camera` looking at `focus`. Mirrors the GLSL in CUTAWAY_GLSL.
 */
export function cutawayAmount(
  p: XYZ,
  camera: XYZ,
  focus: XYZ,
  params: CutawayParams = CUTAWAY_DEFAULTS,
): number {
  if (p.y <= params.keepBelow) return 0;
  const dx = camera.x - focus.x;
  const dz = camera.z - focus.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return 0;
  const ux = dx / len;
  const uz = dz / len;
  const px = p.x - focus.x;
  const pz = p.z - focus.z;
  const along = px * ux + pz * uz;
  const across = Math.abs(px * uz - pz * ux);
  const inFront = smoothstep(params.margin, params.margin + params.soft, along);
  const r = params.radius + params.spread * Math.max(0, along);
  const inside = 1 - smoothstep(r - params.soft, r, across);
  return inFront * inside;
}

/** The 4x4 Bayer matrix, row-major, values 0..15. */
export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

/** Dither threshold in (0, 1) for a pixel; a fragment is dropped when amount > threshold. */
export function bayer4(px: number, py: number): number {
  const x = ((Math.floor(px) % 4) + 4) % 4;
  const y = ((Math.floor(py) % 4) + 4) % 4;
  return ((BAYER4[x + y * 4] ?? 0) + 0.5) / 16;
}

/** True when the fragment at pixel (px, py) with cut amount `amount` is discarded. */
export function cutawayDiscards(amount: number, px: number, py: number): boolean {
  return amount > bayer4(px, py);
}

export interface CutawayUniforms {
  [name: string]: { value: unknown };
  uCutCamera: { value: Vector3 };
  uCutFocus: { value: Vector3 };
  /** (radius, soft, keepBelow, margin). */
  uCutParams: { value: [number, number, number, number] };
  /** Widening of the region per metre toward the camera. */
  uCutSpread: { value: number };
  /** 0 disables cutting (first person, debug), 1 enables it. */
  uCutEnabled: { value: number };
}

/** One set of uniforms shared by every cutaway material; update it once per frame. */
export function createCutawayUniforms(params: CutawayParams = CUTAWAY_DEFAULTS): CutawayUniforms {
  return {
    uCutCamera: { value: new Vector3(0, 10, 10) },
    uCutFocus: { value: new Vector3(0, 0, 0) },
    uCutParams: { value: [params.radius, params.soft, params.keepBelow, params.margin] },
    uCutSpread: { value: params.spread },
    uCutEnabled: { value: 1 },
  };
}

/** Point the cut at a new camera and focus (call each frame). */
export function updateCutaway(u: CutawayUniforms, camera: XYZ, focus: XYZ): void {
  u.uCutCamera.value.set(camera.x, camera.y, camera.z);
  u.uCutFocus.value.set(focus.x, focus.y, focus.z);
}

const VERTEX_HEAD = /* glsl */ `
varying vec3 vCutWorld;
`;

const VERTEX_BODY = /* glsl */ `
{
  vec4 cutWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    cutWorld = instanceMatrix * cutWorld;
  #endif
  vCutWorld = (modelMatrix * cutWorld).xyz;
}
`;

/** The fragment-side maths; keep in step with `cutawayAmount` and `bayer4`. */
export const CUTAWAY_GLSL = /* glsl */ `
varying vec3 vCutWorld;
uniform vec3 uCutCamera;
uniform vec3 uCutFocus;
uniform vec4 uCutParams;
uniform float uCutEnabled;
uniform float uCutSpread;

float cutBayer4(vec2 frag) {
  int x = int(mod(floor(frag.x), 4.0));
  int y = int(mod(floor(frag.y), 4.0));
  int m[16] = int[16](${BAYER4.join(", ")});
  return (float(m[x + y * 4]) + 0.5) / 16.0;
}

float cutawayAmount(vec3 p) {
  if (uCutEnabled < 0.5 || p.y <= uCutParams.z) return 0.0;
  vec2 d = uCutCamera.xz - uCutFocus.xz;
  float len = length(d);
  if (len < 1e-4) return 0.0;
  vec2 u = d / len;
  vec2 q = p.xz - uCutFocus.xz;
  float along = dot(q, u);
  float across = abs(q.x * u.y - q.y * u.x);
  float inFront = smoothstep(uCutParams.w, uCutParams.w + uCutParams.y, along);
  float r = uCutParams.x + uCutSpread * max(0.0, along);
  float inside = 1.0 - smoothstep(r - uCutParams.y, r, across);
  return inFront * inside;
}
`;

const FRAGMENT_BODY = /* glsl */ `
if (cutawayAmount(vCutWorld) > cutBayer4(gl_FragCoord.xy)) discard;
`;

/** Patch a material's shaders with the cutaway; `uniforms` are shared by reference. */
export function applyCutaway<M extends Material>(material: M, uniforms: CutawayUniforms): M {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_HEAD}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${CUTAWAY_GLSL}`)
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>\n${FRAGMENT_BODY}`,
      );
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|lair-cutaway`;
  material.needsUpdate = true;
  return material;
}
