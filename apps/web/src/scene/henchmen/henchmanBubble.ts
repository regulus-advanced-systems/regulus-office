/**
 * A henchman's bubble as one viewer reads it (#256). The server words a
 * "needs you" bubble for the henchman's owner ("waiting for you: approve a
 * command"); everyone else in the room reads who it waits for instead.
 */
import type { AgentBubble, HenchmanState } from "@regulus/protocol";

const FOR_YOU = /^waiting for you\b/;

/** Height of the label's base over a seated henchman's origin, metres: clear of the head (the status light is on the shoulders, #281). */
export const OVERHEAD_HEIGHT = 1.36;

export function bubbleForViewer(
  henchman: Pick<HenchmanState, "bubble" | "ownerUserId" | "ownerName">,
  viewerId: string | null | undefined,
): AgentBubble {
  const bubble = henchman.bubble;
  if (bubble.kind !== "needs_you" || !viewerId || viewerId === henchman.ownerUserId) return bubble;
  const who = henchman.ownerName.trim() || "its owner";
  return { ...bubble, text: bubble.text.replace(FOR_YOU, `waiting for ${who}`) };
}
