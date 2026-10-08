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
 *
 * With a `field` (#283, overheadField.ts) a room stays quiet: the "doing" bubble
 * shows only near the viewer's character or under the cursor, the name tag the
 * same at a longer radius (always for the viewer's `own` agents), and the
 * bubbles that ask always show and are stacked clear of each other. All of it
 * happens in the render loop; nothing here is React state.
 */
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import type { AgentBubble } from "@regulus/protocol";
import { useEffect, useMemo, useRef } from "react";
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
  pixelsPerMetre,
  TAG_FADE,
} from "./bubbleStyle.ts";
import { bubbleTextureFor, nameTagTextureFor } from "./bubbleTexture.ts";
import type { OverheadField, StackSlot } from "./overheadField.ts";
import { fadeToward, overheadVisibility } from "./overheadVisibility.ts";

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
  /**
   * Shared by the labels of one layer: who is near the viewer or under the cursor, and the
   * stacking of the bubbles that ask (#283). Without it every label shows, as an agent on its own.
   */
  field?: OverheadField;
  /** The agent is the viewer's own: its name tag shows at any distance. */
  own?: boolean;
  /**
   * For an agent that walks (#252): where it stands now, in the field's frame, read every
   * frame; `position` is then relative to whatever moves it. Omit for an agent that stays put.
   */
  anchor?: { readonly x: number; readonly z: number };
}

const GAP = 0.25;
/** Below this a label is not drawn (and not a click target). */
const SHOWN = 0.02;
/** How fast a stacked bubble moves to its place, 1/s. */
const STACK_EASE = 10;
const here = new Vector3();
const above = new Vector3();

export function AgentOverhead({
  id,
  name,
  bubble,
  position,
  still,
  lift = 0,
  onOpen,
  field,
  own = false,
  anchor,
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
  // Eased in the render loop; -1 until the first frame, which starts where it should be.
  const shown = useRef({ tag: -1, bubble: -1, stack: 0 });
  const [x, , z] = position;

  // A bubble that always shows takes a slot in the field, to be stacked clear of the others.
  const stacked = !!field && (kind === "needs_you" || kind === "answer_ready");
  const slot = useRef<StackSlot | null>(null);
  useEffect(() => {
    if (!field || !stacked) return;
    const mine: StackSlot = { id, x: 0, y: 0, w: 0, h: 0, active: false, offset: 0 };
    slot.current = mine;
    field.slots.set(id, mine);
    return () => {
      slot.current = null;
      if (field.slots.get(id) === mine) field.slots.delete(id);
    };
  }, [field, stacked, id]);

  // Size for the screen, fade with distance, stacking, bob: per frame, no React state.
  useFrame(({ camera, clock }, dt) => {
    const group = root.current;
    if (!group) return;
    // Sized by how far this label is from the camera, faded by how far the view is zoomed out.
    const zoomedOut = cameraView.distance;
    const view = {
      distance: camera.position.distanceTo(group.getWorldPosition(here)),
      fovDeg: camera instanceof PerspectiveCamera ? camera.fov : 40,
      viewportPx: size.height,
    };
    // Who sees what (#283): near the viewer, under the cursor, the viewer's own, or asking.
    const snap = field?.reducedMotion ?? false;
    const want = overheadVisibility({
      distance: !field
        ? 0
        : field.viewer
          ? Math.hypot((anchor?.x ?? x) - field.viewer.x, (anchor?.z ?? z) - field.viewer.z)
          : Infinity,
      hovered: !!field && (field.hoveredId === id || field.focusedId === id),
      own,
      kind,
      activityBubbles: field?.activityBubbles ?? true,
      reducedMotion: snap,
    });
    const s = shown.current;
    s.tag = s.tag < 0 ? want.tag : fadeToward(s.tag, want.tag, dt, snap);
    s.bubble = s.bubble < 0 ? want.bubble : fadeToward(s.bubble, want.bubble, dt, snap);

    let top = 0;
    const tagSprite = tagRef.current;
    if (tagSprite && tag) {
      const h = labelWorldHeight(NAME_TAG, view);
      tagSprite.scale.set(h * tag.aspect, h, 1);
      const fade = distanceFade(zoomedOut, TAG_FADE) * s.tag;
      tagSprite.material.opacity = NAME_TAG.opacity * fade;
      tagSprite.visible = fade > SHOWN;
      // The bubble keeps its place whether or not the tag shows, so nothing jumps.
      top = h * (1 + GAP);
    }
    group.userData.tagShown = !!tagSprite?.visible;
    const sprite = bubbleRef.current;
    const mine = slot.current;
    if (sprite && plate && look && kind) {
      const h = labelWorldHeight(look, view);
      sprite.scale.set(h * plate.aspect, h, 1);
      const fade = distanceFade(zoomedOut, kind === "doing" ? ACTIVITY_FADE : ASK_FADE) * s.bubble;
      sprite.material.opacity = look.opacity * fade;
      sprite.visible = fade > SHOWN;
      let raise = lift * h * 1.1;
      if (mine) {
        // Its box on screen, at rest; the field answers with how far up it has to move.
        here.y += top;
        above
          .copy(here)
          .setY(here.y + 1)
          .project(camera);
        here.project(camera);
        const upPx = ((here.y - above.y) / -2) * size.height;
        mine.active = sprite.visible && here.z < 1 && upPx > 0.5;
        mine.h = h * pixelsPerMetre(view);
        mine.w = mine.h * plate.aspect;
        mine.x = ((here.x + 1) / 2) * size.width;
        mine.y = ((1 - here.y) / 2) * size.height;
        const target = mine.active ? mine.offset / upPx : 0;
        s.stack = snap ? target : s.stack + (target - s.stack) * Math.min(1, dt * STACK_EASE);
        raise = s.stack;
      }
      const bob = bubbleBobs(kind, { still }) ? bobOffset(clock.elapsedTime) * h : 0;
      sprite.position.y = top + raise + bob;
    } else if (mine) mine.active = false;
    group.userData.bubbleShown = !!sprite?.visible;
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
