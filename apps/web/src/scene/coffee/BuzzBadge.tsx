/**
 * The cup over a buzzed human's head (#63): how many cups, or "Jitters" from
 * the third. It reads the human's own presence entry, which this viewer has
 * only while they may see the person (per-viewer state, #270), so it shows
 * for nobody they could not already see. A sprite with the emote badge's
 * look; it stands still, so it also carries the jitters for viewers with
 * reduced motion. Named `buzz-badge` (userData.cups, userData.jitters).
 */
import { hasJitters } from "@regulus/protocol";
import { emoteBadgeTexture } from "../social/bubbleTexture.ts";
import { buzzBadge } from "./buzz.ts";

export function BuzzBadge({ cups }: { cups: number }) {
  const badge = buzzBadge(cups);
  if (!badge) return null;
  const tex = emoteBadgeTexture(badge.icon, badge.label);
  return (
    <sprite
      name="buzz-badge"
      userData={{ cups, jitters: hasJitters({ cups }) }}
      center-y={0}
      scale={[tex.width, tex.height, 1]}
      renderOrder={11}
    >
      <spriteMaterial map={tex.texture} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
