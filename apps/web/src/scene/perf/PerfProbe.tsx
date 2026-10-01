/**
 * The perf probe (#190, SPEC §11): records every frame's interval and
 * main-thread time and publishes `window.__regulusPerf` (only with `?stats`):
 * `reset()` starts a fresh window, `sample()` returns frame-time
 * percentiles, draw calls, triangles, texture memory, the detail tier and
 * the recent FloorRoom join times. The perf script (scripts/perf/) and the
 * e2e perf report read it.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Material, Mesh, Object3D, WebGLRenderer } from "three";
import { type JoinTime, recentJoins } from "../../net/joinTimes.ts";
import { useQualityStore } from "../compound/quality.ts";
import { type FrameSummary, Ring, summarise, textureMemory } from "./frameStats.ts";

export interface PerfSample extends FrameSummary {
  drawCalls: number;
  triangles: number;
  textures: number;
  textureMB: number;
  geometries: number;
  programs: number;
  width: number;
  height: number;
  quality: string;
  renderer: string;
  joins: JoinTime[];
}

declare global {
  interface Window {
    __regulusPerf?: { reset: () => void; sample: () => PerfSample };
  }
}

const FRAMES = 900;

function materialsOf(scene: Object3D): Material[] {
  const out: Material[] = [];
  scene.traverseVisible((o) => {
    const m = (o as Mesh).material;
    if (Array.isArray(m)) out.push(...m);
    else if (m) out.push(m);
  });
  return out;
}

function rendererName(gl: WebGLRenderer): string {
  const ctx = gl.getContext();
  const ext = ctx.getExtension("WEBGL_debug_renderer_info");
  return ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
}

export function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const ring = useRef({ intervals: new Ring(FRAMES), cpu: new Ring(FRAMES), last: 0, start: 0 });
  const frame = useRef({ calls: 0, triangles: 0 });

  // Frame start: before every other subscriber.
  useFrame(() => {
    const r = ring.current;
    const now = performance.now();
    if (r.last) r.intervals.push(now - r.last);
    r.last = now;
    r.start = now;
  }, -1e9);

  // Frame end: right after the renderer drew the scene (R3F calls render after the subscribers).
  useEffect(() => {
    const render = gl.render.bind(gl);
    gl.render = (s, c) => {
      render(s, c);
      if (s !== scene) return;
      const r = ring.current;
      if (r.start) r.cpu.push(performance.now() - r.start);
      frame.current.calls = gl.info.render.calls;
      frame.current.triangles = gl.info.render.triangles;
    };
    return () => {
      gl.render = render;
    };
  }, [gl, scene]);

  useEffect(() => {
    window.__regulusPerf = {
      reset: () => {
        ring.current.intervals.clear();
        ring.current.cpu.clear();
        ring.current.last = 0;
      },
      sample: () => {
        const tex = textureMemory(materialsOf(scene));
        const canvas = gl.domElement;
        return {
          ...summarise(ring.current.intervals.values(), ring.current.cpu.values()),
          drawCalls: frame.current.calls,
          triangles: frame.current.triangles,
          textures: tex.count,
          textureMB: Math.round((tex.bytes / 1048576) * 10) / 10,
          geometries: gl.info.memory.geometries,
          programs: gl.info.programs?.length ?? 0,
          width: canvas.width,
          height: canvas.height,
          quality: useQualityStore.getState().quality,
          renderer: rendererName(gl),
          joins: recentJoins(),
        };
      },
    };
    return () => {
      window.__regulusPerf = undefined;
    };
  }, [gl, scene]);

  return null;
}
