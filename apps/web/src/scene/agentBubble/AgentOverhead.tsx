/**
 * What floats over an agent (SPEC §9.3, D29; #256): its name, small and quiet,
 * and above it one bubble saying what it is doing ("reading auth.ts"), that it
 * needs you, or that it has an answer ready. One component for every agent:
 * henchmen pass `HenchmanState.name` and `.bubble`; office agents pass their
 * own name and an `AgentBubble` built the same way.
 *
 * Two sprites (two quads, no DOM). They have a size in the world, never drop below
 * a readable size on screen at the room framing, fade out towards the overview, and hold still with reduced
 * motion or on the low graphics preset (`still`). A bubble that asks for
 * something is a click target: `onOpen` gets the bubble.
 */
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import type { AgentBubble } from "@regulus/protocol";
import { useMemo, useRef } from "react";
import { type Group, PerspectiveCamera, type Sprite, Vector3 } from "three";
import { cameraView } from "../../state/camera.ts";
import {
  ACTIVITY_FADE,
  ASK_FADE,
  BUBBLE_LOOKS,
  bobOffset,
  bubbleBobs,
  bubbleClickable,
  distanceFade,
  labelWorldHeight,
  NAME_TAG,
  TAG_FADE,
} from "./bubbleStyle.ts";
import { bubbleTextureFor, nameTagTextureFor } from "./bubbleTexture.ts";

export interface AgentOverheadProps {
  /** Scene object names (`agent-overhead-<id>`, `agent-bubble-<id>`), read by the e2e probes. */
  id: string;
  name: string;
  /** Already filtered for this viewer (bubbleStyle.ts `visibleBubble`); null draws no bubble. */
  bubble: AgentBubble | null;
  /** Where the label starts: world position just above the agent's head. */
  position: readonly [number, number, number];
  /** No motion: reduced motion, or the low graphics preset. */
  still: boolean;
  /**
   * Raise the bubble by this many bubble heights, so neighbours at one desk block
   * do not cover each other (the caller alternates 0 and 1).
   */
  lift?: number;
  /** A click on a bubble that asks for something. Omit where the scene is not interactive. */
  onOpen?: (bubble: AgentBubble) => void;
}

const GAP = 0.25;
const here = new Vector3();

export function AgentOverhead({
  id,
  name,
  bubble,
  position,
  still,
  lift = 0,
  onOpen,
}: AgentOverheadProps) {
  const tag = useMemo(() => (name ? nameTagTextureFor(name) : null), [name]);
  const kind = bubble && bubble.kind !== "none" ? bubble.kind : null;
  const text = bubble?.text ?? "";
  const plate = useMemo(() => (kind ? bubbleTextureFor(kind, text) : null), [kind, text]);
  const look = kind ? BUBBLE_LOOKS[kind] : null;
  const clickable = !!onOpen && bubbleClickable(bubble);

  const root = useRef<Group>(null);
  const tagRef = useRef<Sprite>(null);
  const bubbleRef = useRef<Sprite>(null);
  const size = useThree((s) => s.size);

  // Size for the screen, fade with distance, bob: per frame, no React state.
  useFrame(({ camera, clock }) => {
    const group = root.current;
    if (!group) return;
    // Sized by how far this label is from the camera, faded by how far the view is zoomed out.
    const zoomedOut = cameraView.distance;
    const view = {
      distance: camera.position.distanceTo(group.getWorldPosition(here)),
      fovDeg: camera instanceof PerspectiveCamera ? camera.fov : 40,
      viewportPx: size.height,
    };
    let top = 0;
    const tagSprite = tagRef.current;
    if (tagSprite && tag) {
      const h = labelWorldHeight(NAME_TAG, view);
      tagSprite.scale.set(h * tag.aspect, h, 1);
      const fade = distanceFade(zoomedOut, TAG_FADE);
      tagSprite.material.opacity = NAME_TAG.opacity * fade;
      tagSprite.visible = fade > 0.02;
      top = h * (1 + GAP);
    }
    const sprite = bubbleRef.current;
    if (sprite && plate && look && kind) {
      const h = labelWorldHeight(look, view);
      sprite.scale.set(h * plate.aspect, h, 1);
      const bob = bubbleBobs(kind, { still }) ? bobOffset(clock.elapsedTime) * h : 0;
      sprite.position.y = top + lift * h * 1.1 + bob;
      const fade = distanceFade(zoomedOut, kind === "doing" ? ACTIVITY_FADE : ASK_FADE);
      sprite.material.opacity = look.opacity * fade;
      sprite.visible = fade > 0.02;
    }
  });

  const open = (event: ThreeEvent<MouseEvent>) => {
    if (!clickable || !bubble || event.nativeEvent.button !== 0) return;
    event.stopPropagation();
    onOpen?.(bubble);
  };

  return (
    <group
      ref={root}
      name={`agent-overhead-${id}`}
      position={[position[0], position[1], position[2]]}
      // Read by the e2e scene probes; plain data, no behaviour.
      userData={{ name, bubbleKind: kind ?? "none", bubbleText: kind ? text : "", clickable }}
    >
      {tag && (
        <sprite ref={tagRef} name={`agent-name-tag-${id}`} center-y={0} renderOrder={11}>
          <spriteMaterial
            map={tag.texture}
            transparent
            opacity={NAME_TAG.opacity}
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </sprite>
      )}
      {plate && look && (
        <sprite
          ref={bubbleRef}
          name={`agent-bubble-${id}`}
          center-y={0}
          renderOrder={kind === "doing" ? 12 : 13}
          onClick={clickable ? open : undefined}
          onPointerOver={clickable ? () => (document.body.style.cursor = "pointer") : undefined}
          onPointerOut={clickable ? () => (document.body.style.cursor = "") : undefined}
        >
          <spriteMaterial
            map={plate.texture}
            transparent
            opacity={look.opacity}
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </sprite>
      )}
    </group>
  );
}
