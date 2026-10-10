/**
 * What floats over a human's head besides the name plate (#49): the speech
 * bubble of the line they said last, fading out (bubbles.ts), and with
 * reduced motion the badge of the emote they are holding (the pose itself
 * stands still), and (#48) the voice badge: muted, or on the TV, and (#63)
 * the cup of a human with a coffee buzz. Sprites,
 * so they always face the camera. Named for the e2e probes: `chat-bubble`
 * (userData.text), `emote-badge` (userData.emote), `voice-badge` (userData.kind),
 * `buzz-badge` (userData.cups).
 */
import { useFrame } from "@react-three/fiber";
import { EMOTE_LABELS, type Emote } from "@regulus/protocol";
import { useEffect, useMemo, useRef } from "react";
import type { Sprite, SpriteMaterial } from "three";
import { useBuildingStore } from "../../state/building.ts";
import { selectReducedMotion, useUiStore } from "../../state/ui.ts";
import { BuzzBadge } from "../coffee/BuzzBadge.tsx";
import { useCups } from "../coffee/Jitters.tsx";
import { bubbleOpacity, createBubbleTracker, useBubbleStore } from "./bubbles.ts";
import { bubbleTexture, emoteBadgeTexture } from "./bubbleTexture.ts";
import { useVoiceBadge, VoiceBadge } from "./VoiceBadge.tsx";

/** Feed live chat lines into the bubble store; mount once (the avatar layer). */
export function useChatBubbleFeed(): void {
  useEffect(() => {
    const tracker = createBubbleTracker();
    const feed = () => {
      const chat = useBuildingStore.getState().state?.chat;
      if (chat) useBubbleStore.getState().add(tracker.observe(chat, performance.now()));
    };
    feed();
    const unsub = useBuildingStore.subscribe((s, prev) => {
      if (s.state?.chat !== prev.state?.chat) feed();
    });
    const timer = setInterval(() => useBubbleStore.getState().prune(performance.now()), 1000);
    return () => {
      unsub();
      clearInterval(timer);
      useBubbleStore.getState().clear();
    };
  }, []);
}

function ChatBubble({ userId }: { userId: string }) {
  const bubble = useBubbleStore((s) => s.byUser[userId]);
  const reducedMotion = useUiStore(selectReducedMotion);
  const sprite = useRef<Sprite>(null);
  const material = useRef<SpriteMaterial>(null);
  const tex = useMemo(() => (bubble ? bubbleTexture(bubble.text) : null), [bubble]);
  useEffect(() => () => tex?.texture.dispose(), [tex]);

  useFrame(() => {
    if (!bubble || !sprite.current || !material.current) return;
    const opacity = bubbleOpacity(performance.now() - bubble.shownAt, reducedMotion);
    material.current.opacity = opacity;
    sprite.current.visible = opacity > 0;
  });

  if (!bubble || !tex) return null;
  return (
    <sprite
      ref={sprite}
      name="chat-bubble"
      userData={{ text: bubble.text, messageId: bubble.id }}
      position={[0, 0, 0]}
      center-y={0}
      scale={[tex.width, tex.height, 1]}
      renderOrder={11}
    >
      <spriteMaterial
        ref={material}
        map={tex.texture}
        transparent
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </sprite>
  );
}

function EmoteBadge({ emote }: { emote: Emote }) {
  const { icon, label } = EMOTE_LABELS[emote];
  const tex = useMemo(() => emoteBadgeTexture(icon, label), [icon, label]);
  return (
    <sprite
      name="emote-badge"
      userData={{ emote }}
      center-y={0}
      scale={[tex.width, tex.height, 1]}
      renderOrder={11}
    >
      <spriteMaterial map={tex.texture} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

export interface OverheadProps {
  userId: string;
  /** The emote held now, shown as a badge (reduced motion only). */
  emote?: Emote | null;
  /** Building session id, for the voice badge (#48). */
  sessionId?: string;
}

/** Bubble above the badge, both above the name plate (the parent places this group). */
export function Overhead({ userId, emote, sessionId }: OverheadProps) {
  const reducedMotion = useUiStore(selectReducedMotion);
  const badge = reducedMotion && emote ? emote : null;
  const voice = useVoiceBadge(sessionId);
  const cups = useCups(sessionId);
  const below = (voice ? 1 : 0) + (cups > 0 ? 1 : 0);
  const stack = below + (badge ? 1 : 0);
  return (
    <group name="overhead">
      {voice && <VoiceBadge kind={voice} />}
      {cups > 0 && (
        <group position={[0, voice ? BADGE_STEP : 0, 0]}>
          <BuzzBadge cups={cups} />
        </group>
      )}
      {badge && (
        <group position={[0, below * BADGE_STEP, 0]}>
          <EmoteBadge emote={badge} />
        </group>
      )}
      <group position={[0, stack * BADGE_STEP, 0]}>
        <ChatBubble userId={userId} />
      </group>
    </group>
  );
}

/** Height of one badge row, metres. */
const BADGE_STEP = 0.38;
