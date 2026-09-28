/**
 * Frame-rate counter for the showcase: publishes rolling stats on
 * `window.__avatarStats` (read by the headless measurement script) and mirrors
 * them into `#stats`. With `probe`, also logs rig measurements once.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { Box3, type Object3D, Vector3 } from "three";
import { materialCacheSize } from "../toonMaterial.ts";

export type AvatarStats = {
  fps: number;
  minFps: number;
  frames: number;
  seconds: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  materials: number;
  renderer: string;
};

declare global {
  interface Window {
    __avatarStats?: AvatarStats;
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
  });
  useFrame((_, delta) => {
    const a = acc.current;
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
      frames: a.frames,
      seconds: Math.round(a.total * 10) / 10,
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      programs: gl.info.programs?.length ?? 0,
      materials: materialCacheSize(),
      renderer: debug ? String(ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "unknown",
    };
    window.__avatarStats = stats;
    const el = document.getElementById("stats");
    if (el)
      el.textContent = `${stats.fps} fps (min ${stats.minFps}) | ${stats.drawCalls} calls | ${stats.triangles} tris | ${stats.renderer}`;
    a.t = 0;
    a.n = 0;
    if (probe && !a.probed) {
      a.probed = true;
      logRig(scene);
    }
  });
  return null;
}

/** One-off measurement of the loaded rig, used to derive the constants in accessories.tsx. */
function logRig(scene: Object3D) {
  const first = scene.children.find((c) => c.name === "" && c.children.length > 0);
  const root = first?.getObjectByProperty("type", "SkinnedMesh")?.parent;
  if (!root) return;
  const box = new Box3().setFromObject(root);
  console.log("rig: bbox", box.min.toArray().map(fmt), box.max.toArray().map(fmt));
  const found: Record<string, Object3D> = {};
  root.traverse((o) => {
    const bone = o as Object3D & { isBone?: boolean };
    if (bone.isBone && ["Head", "Body", "UpperArm.R"].includes(o.name)) found[o.name] = o;
    if (!bone.isBone && ["Head", "Torso"].includes(o.name)) found[`mesh:${o.name}`] = o;
  });
  for (const [name, object] of Object.entries(found)) {
    const world = object.getWorldPosition(new Vector3());
    const b = new Box3().setFromObject(object);
    const axes = ["x", "y", "z"].map((axis) => {
      const v = new Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
      return `${axis}->${v.transformDirection(object.matrixWorld).toArray().map(fmt).join(",")}`;
    });
    const local = (p: Vector3) => object.worldToLocal(p.clone()).toArray().map(fmt).join(",");
    console.log(
      `rig: ${name} world=${world.toArray().map(fmt)} bboxMin=${b.min.toArray().map(fmt)} bboxMax=${b.max.toArray().map(fmt)} ${axes.join(" ")} localTop=${local(new Vector3(world.x, b.max.y, world.z))} localFront=${local(new Vector3(world.x, world.y, b.max.z))}`,
    );
  }
}

function fmt(n: number): string {
  return n.toFixed(3);
}
