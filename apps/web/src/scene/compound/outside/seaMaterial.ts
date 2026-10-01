/**
 * The sea's material (SPEC §12: "cheap stylised water", no reflections;
 * #188). The geometry carries the water's colour per vertex (turquoise
 * shallows to deep blue) and its distance from the shore; the shader adds
 * only cheap per-pixel touches: a slow swell in the vertices, two crossing
 * travelling sine fields thresholded into pale streaks (the toon look), a
 * white foam line on the shore and wave lines rolling in across the
 * shallows. No textures, no lights, no reflections, one draw.
 *
 * The low tier (software WebGL) draws the same grid with a plain
 * vertex-coloured MeshBasicMaterial instead.
 */
import { Color, ShaderMaterial } from "three";
import { SEA } from "./water.ts";

export type SeaUniforms = {
  uTime: { value: number };
  uFoam: { value: Color };
};

const VERTEX = /* glsl */ `
attribute float depth;
varying vec3 vColor;
varying float vDepth;
varying vec2 vXZ;
uniform float uTime;
void main() {
  vColor = color;
  vDepth = depth;
  vec3 p = position;
  float far = clamp(depth / 6.0, 0.0, 1.0);
  p.y += sin(p.x * 0.21 + uTime * 0.9) * sin(p.z * 0.17 - uTime * 0.7) * 0.05 * far;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vXZ = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vDepth;
varying vec2 vXZ;
uniform float uTime;
uniform vec3 uFoam;
void main() {
  vec3 col = vColor;
  // Stylised swell: crossing travelling waves, cut into soft bands.
  float w = sin(vXZ.x * 0.16 + uTime * 0.55 + sin(vXZ.y * 0.07) * 2.0) * sin(vXZ.y * 0.22 - uTime * 0.75);
  col += smoothstep(0.55, 0.8, w) * 0.08;
  col -= smoothstep(-0.55, -0.85, w) * 0.025;
  // Foam: the line where the sea meets the sand, and wave lines rolling in.
  float edge = 1.0 - smoothstep(0.05, 0.6, vDepth);
  float roll = fract(vDepth * 0.32 + uTime * 0.16);
  float lines = smoothstep(0.86, 0.95, roll) * (1.0 - smoothstep(1.5, 7.0, vDepth));
  col = mix(col, uFoam, clamp(max(edge, lines * 0.75), 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export function createSeaMaterial(): ShaderMaterial & { uniforms: SeaUniforms } {
  const uniforms: SeaUniforms = { uTime: { value: 0 }, uFoam: { value: new Color(SEA.foam) } };
  const material = new ShaderMaterial({
    name: "sea",
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    vertexColors: true,
  });
  return material as ShaderMaterial & { uniforms: SeaUniforms };
}
