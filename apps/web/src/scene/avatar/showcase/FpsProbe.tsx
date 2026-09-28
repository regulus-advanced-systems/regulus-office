/**
 * Frame-rate counter for the showcase: publishes rolling stats on
 * `window.__avatarStats` (read by the headless measurement script) and mirrors
 * them into `#stats`. With `probe`, also logs rig measurements once.
 */

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { Box3, type Object3D, Vector3 } from "three";
import { ROBOT_MODEL_URL } from "../avatarRig.ts";
import { materialCacheSize } from "../toonMaterial.ts";

export type AvatarStats = {
  fps: number;
  minFps: number;
  frames: number;
  seconds: number;
  /** Average main-thread time per frame (mixers, React, three submission), ms. */
  cpuMs: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  materials: number;
  renderer: string;
};

declare global {
  interface Window {
    __avatarStats?: AvatarStats;
    __scene?: Object3D;
  }
}

const WINDOW_SECONDS = 1;

export function FpsProbe({ probe }: { probe: boolean }) {
  const { gl, scene } = useThree();
  const acc = useRef({
    t: 0,
    n: 0,
    total: 0,
    frames: 0,
    minFps: Number.POSITIVE_INFINITY,
    probed: false,
    frameStart: 0,
    cpu: 0,
    cpuN: 0,
  });
  // Runs first each frame (before the mixers); the render subscriber below runs last and
  // takes over the render call, so the pair times the whole main-thread frame.
  useFrame(() => {
    acc.current.frameStart = performance.now();
  }, -1e9);
  useFrame((state, delta) => {
    state.gl.render(state.scene, state.camera);
    const a = acc.current;
    a.cpu += performance.now() - a.frameStart;
    a.cpuN += 1;
    a.t += delta;
    a.n += 1;
    a.total += delta;
    a.frames += 1;
    if (a.t < WINDOW_SECONDS) return;
    const fps = a.n / a.t;
    if (a.total > 2) a.minFps = Math.min(a.minFps, fps);
    const debug = gl.getContext().getExtension("WEBGL_debug_renderer_info");
    const ctx = gl.getContext();
    const stats: AvatarStats = {
      fps: Math.round(fps * 10) / 10,
      minFps: Number.isFinite(a.minFps) ? Math.round(a.minFps * 10) / 10 : 0,
      cpuMs: Math.round((a.cpu / Math.max(1, a.cpuN)) * 100) / 100,
      frames: a.frames,
      seconds: Math.round(a.total * 10) / 10,
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      programs: gl.info.programs?.length ?? 0,
      materials: materialCacheSize(),
      renderer: debug ? String(ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "unknown",
    };
    window.__avatarStats = stats;
    window.__scene = scene;
    const el = document.getElementById("stats");
    if (el)
      el.textContent = `${stats.fps} fps (min ${stats.minFps}) | ${stats.cpuMs} ms main thread | ${stats.drawCalls} calls | ${stats.triangles} tris | ${stats.renderer}`;
    a.t = 0;
    a.n = 0;
    a.cpu = 0;
    a.cpuN = 0;
    if (probe && !a.probed) {
      a.probed = true;
      logRig(scene);
      const gltf = useGLTF(ROBOT_MODEL_URL);
      for (const clip of gltf.animations) {
        console.log(
          `clip: ${clip.name} ${clip.duration.toFixed(2)}s tracks=${clip.tracks.map((t) => t.name).join(" ")}`,
        );
      }
    }
  });
  return null;
}

/** One-off measurement of the loaded rig, used to derive the constants in accessories.tsx. */
function logRig(scene: Object3D) {
  const skinned = scene.getObjectByProperty("type", "SkinnedMesh");
  const root = skinned?.parent?.parent;
  if (!root) {
    console.log("rig: no skinned mesh found");
    return;
  }
  const lines: string[] = [];
  root.traverse((o) => {
    const depth = ancestors(o, root);
    lines.push(
      `${"  ".repeat(depth)}${o.type}:${o.name} vis=${o.visible} s=${o.scale.toArray().map(fmt)}`,
    );
  });
  console.log(`rig: graph\n${lines.slice(0, 40).join("\n")}`);
  const box = new Box3().setFromObject(root);
  console.log(`rig: bbox ${box.min.toArray().map(fmt)} -> ${box.max.toArray().map(fmt)}`);
  root.traverse((o) => {
    const bone = o as Object3D & { isBone?: boolean };
    const wanted = ["Head", "Body", "Torso", "Hand.R", "UpperArm.R"].includes(o.name);
    if (!wanted) return;
    const world = o.getWorldPosition(new Vector3());
    const b = new Box3().setFromObject(o);
    const axes = ["x", "y", "z"].map((axis) => {
      const v = new Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
      return `${axis}->${v.transformDirection(o.matrixWorld).toArray().map(fmt).join(",")}`;
    });
    const local = (p: Vector3) => o.worldToLocal(p.clone()).toArray().map(fmt).join(",");
    console.log(
      `rig: ${bone.isBone ? "bone" : o.type}:${o.name} world=${world.toArray().map(fmt)} bbox=${b.min.toArray().map(fmt)}->${b.max.toArray().map(fmt)} ${axes.join(" ")} localTop=${local(new Vector3(world.x, b.max.y, world.z))} localFrontZ=${local(new Vector3(world.x, world.y, b.max.z))} localBackZ=${local(new Vector3(world.x, world.y, b.min.z))}`,
    );
  });
}

function ancestors(o: Object3D, root: Object3D): number {
  let n = 0;
  for (let p = o.parent; p && p !== root; p = p.parent) n++;
  return n;
}

function fmt(n: number): string {
  return n.toFixed(3);
}
