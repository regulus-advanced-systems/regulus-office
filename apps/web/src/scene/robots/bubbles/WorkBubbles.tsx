/**
 * GDT work bubbles (SPEC §9.3): each robot's laptop emits a bubble per new
 * tool call / edit / test run / failure, which drifts up and flies to the
 * matching HUD counter (ui/hud/WorkCounters.tsx). All bubbles are one
 * InstancedMesh (one draw call) over a fixed pool; bursts are capped per
 * update and per robot and spread out in time. Not mounted with reduced
 * motion (SPEC §11); then the counters just show the totals.
 */
import { useFrame, useThree } from "@react-three/fiber";
import type { BubbleEmits } from "@regulus/protocol";
import { useEffect, useMemo, useRef } from "react";
import {
  CanvasTexture,
  CircleGeometry,
  Color,
  type InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import { useWorkBubbles } from "../../../state/workBubbles.ts";
import { counterAnchorPoint } from "../../../ui/hud/workCounterAnchors.ts";
import { BUBBLE_COLORS, type BubbleKind, bubbleDelta, bubblesFor } from "./bubbleEmits.ts";
import { BubblePool } from "./bubblePool.ts";
import { BubbleQueue } from "./bubbleQueue.ts";
import {
  BUBBLE_LIFETIME,
  bubbleScale,
  flyPosition,
  RISE_SECONDS,
  risePosition,
  type V3,
} from "./trajectory.ts";

/** Pool size: bubbles on screen at once across the floor. */
export const MAX_BUBBLES = 96;
/** On-screen diameter at 1080p (research 03 §4: ~20-28 px). */
const BUBBLE_PX = 24;
/** Diameter in world units for a perspective (first-person) camera. */
const PERSPECTIVE_SIZE = 0.16;

export interface BubbleSource {
  agentId: string;
  bubbleEmits: BubbleEmits;
  /** Laptop position the bubbles pop out of. */
  origin: V3;
}

function bubbleTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const c = size / 2;
  // Darker rim, flat fill, small highlight; the instance colour tints it all.
  ctx.fillStyle = "#9a9a9a";
  ctx.beginPath();
  ctx.arc(c, c, c - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(c, c, c - 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.ellipse(c - 9, c - 10, 7, 5, -0.6, 0, Math.PI * 2);
  ctx.fill();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function WorkBubbles({ sources }: { sources: readonly BubbleSource[] }) {
  const mesh = useRef<InstancedMesh>(null);
  const { camera, gl } = useThree();
  const launch = useWorkBubbles((s) => s.launch);
  const land = useWorkBubbles((s) => s.land);
  const reset = useWorkBubbles((s) => s.reset);

  const queue = useMemo(() => new BubbleQueue(), []);
  const pool = useMemo(() => new BubblePool(MAX_BUBBLES), []);
  const seen = useRef(new Map<string, BubbleEmits>());
  const origins = useRef(new Map<string, V3>());

  const geometry = useMemo(() => new CircleGeometry(0.5, 20), []);
  const material = useMemo(() => {
    const map = bubbleTexture();
    return new MeshBasicMaterial({
      map,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  // Counter deltas -> queued bubbles (counted as in flight until they land).
  useEffect(() => {
    const now = performance.now();
    const live = new Set<string>();
    for (const s of sources) {
      live.add(s.agentId);
      origins.current.set(s.agentId, s.origin);
      const kinds = bubblesFor(bubbleDelta(seen.current.get(s.agentId), s.bubbleEmits));
      seen.current.set(s.agentId, s.bubbleEmits);
      if (kinds.length === 0) continue;
      const dropped = queue.push(s.agentId, kinds, now);
      for (const kind of kinds.slice(0, kinds.length - dropped.length)) launch(kind);
    }
    for (const agentId of [...seen.current.keys()]) {
      if (live.has(agentId)) continue;
      seen.current.delete(agentId);
      origins.current.delete(agentId);
      for (const kind of queue.drop(agentId)) land(kind);
    }
  }, [sources, queue, launch, land]);

  // Leaving the floor or switching on reduced motion: nothing stays in flight.
  useEffect(
    () => () => {
      queue.clear();
      pool.clear();
      reset();
    },
    [queue, pool, reset],
  );

  const scratch = useMemo(
    () => ({
      m: new Matrix4(),
      q: new Quaternion(),
      p: new Vector3(),
      s: new Vector3(),
      v: new Vector3(),
      c: new Color(),
      colors: Object.fromEntries(
        Object.entries(BUBBLE_COLORS).map(([k, hex]) => [k, new Color(hex)]),
      ) as Record<BubbleKind, Color>,
    }),
    [],
  );

  const targetFor = (kind: BubbleKind, from: V3, out: V3): V3 => {
    const anchor = counterAnchorPoint(kind);
    if (!anchor) {
      out.x = from.x;
      out.y = from.y + 3;
      out.z = from.z;
      return out;
    }
    const rect = gl.domElement.getBoundingClientRect();
    const v = scratch.v.set(from.x, from.y, from.z).project(camera);
    v.x = ((anchor.x - rect.left) / rect.width) * 2 - 1;
    v.y = -((anchor.y - rect.top) / rect.height) * 2 + 1;
    v.unproject(camera);
    out.x = v.x;
    out.y = v.y;
    out.z = v.z;
    return out;
  };

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    const now = performance.now();
    for (const due of queue.due(now)) {
      const origin = origins.current.get(due.agentId);
      const slot = origin ? pool.acquire(due.kind, origin, now) : null;
      if (!slot) land(due.kind); // pool full: straight to the counter
    }
    const dt = Math.min(delta, 0.1);
    const size =
      "isOrthographicCamera" in camera && camera.isOrthographicCamera
        ? BUBBLE_PX / Math.max(1, camera.zoom)
        : PERSPECTIVE_SIZE;
    let n = 0;
    for (const b of pool.active()) {
      b.t += dt;
      if (b.t >= BUBBLE_LIFETIME) {
        pool.release(b);
        land(b.kind);
        continue;
      }
      if (b.t < RISE_SECONDS) risePosition(b.origin, b.t, b.seed, b.pos);
      else {
        if (!b.flying) {
          b.flying = true;
          b.start.x = b.pos.x;
          b.start.y = b.pos.y;
          b.start.z = b.pos.z;
          targetFor(b.kind, b.start, b.target);
        }
        flyPosition(b.start, b.target, b.t, b.pos);
      }
      const s = size * bubbleScale(b.t);
      scratch.m.compose(
        scratch.p.set(b.pos.x, b.pos.y, b.pos.z),
        camera.quaternion,
        scratch.s.set(s, s, s),
      );
      m.setMatrixAt(n, scratch.m);
      m.setColorAt(n, scratch.colors[b.kind]);
      n += 1;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={mesh}
      name="work-bubbles"
      args={[geometry, material, MAX_BUBBLES]}
      frustumCulled={false}
      renderOrder={10}
    />
  );
}
