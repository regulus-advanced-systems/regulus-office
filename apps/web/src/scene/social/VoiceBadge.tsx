/**
 * Over a human's head (#48): "Muted" when their mic is published but muted,
 * "On the TV" while they share their screen to the lounge TV. A sprite with
 * the emote badge's look (bubbleTexture.ts); nothing for a human not in
 * voice. Named `voice-badge` (userData.kind) for the e2e probes.
 */
import { useMediaStore } from "../../media/store.ts";
import { useBuildingStore } from "../../state/building.ts";
import { emoteBadgeTexture } from "./bubbleTexture.ts";

export type VoiceBadgeKind = "muted" | "sharing";

const BADGES: Record<VoiceBadgeKind, { icon: string; label: string }> = {
  muted: { icon: "🔇", label: "Muted" },
  sharing: { icon: "📺", label: "On the TV" },
};

/** Which badge a human gets. Pure. */
export function voiceBadgeKind(
  mic: "none" | "on" | "muted" | undefined,
  sharingScreen: boolean,
): VoiceBadgeKind | null {
  if (sharingScreen) return "sharing";
  return mic === "muted" ? "muted" : null;
}

/** The badge kind for a session, subscribed (re-renders only when it changes). */
export function useVoiceBadge(sessionId: string | undefined): VoiceBadgeKind | null {
  const mic = useMediaStore((s) => (sessionId ? s.voices[sessionId]?.mic : undefined));
  const sharing = useBuildingStore((s) =>
    sessionId ? Boolean(s.state?.humans[sessionId]?.sharingScreen) : false,
  );
  return voiceBadgeKind(mic, sharing);
}

export function VoiceBadge({ kind }: { kind: VoiceBadgeKind }) {
  const { icon, label } = BADGES[kind];
  const tex = emoteBadgeTexture(icon, label);
  return (
    <sprite
      name="voice-badge"
      userData={{ kind }}
      center-y={0}
      scale={[tex.width, tex.height, 1]}
      renderOrder={11}
    >
      <spriteMaterial map={tex.texture} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
