/**
 * Plain values onto BuildingRoom schema objects: a genius look onto a
 * presence and a chat line into a schema line. Only changed fields patch.
 */
import {
  type ChatMessage,
  ChatMessageSchema,
  type GeniusLookValue,
  type HumanPresenceSchema,
} from "@regulus/protocol";

type Human = InstanceType<typeof HumanPresenceSchema>;

/** Copy a (validated) genius look onto a presence; only changed fields make a patch. */
export function applyLook(human: Human, look: GeniusLookValue): void {
  const avatar = human.avatar;
  if (avatar.archetype !== look.archetype) avatar.archetype = look.archetype;
  if (avatar.outfit !== look.outfit) avatar.outfit = look.outfit;
  if (avatar.trim !== look.trim) avatar.trim = look.trim;
  if (avatar.skin !== look.skin) avatar.skin = look.skin;
  if (avatar.hair !== look.hair) avatar.hair = look.hair;
  if (avatar.accessory !== look.accessory) avatar.accessory = look.accessory;
}

/** A chat line as a schema object for `BuildingState.chat`. */
export function chatLine(m: ChatMessage): InstanceType<typeof ChatMessageSchema> {
  const line = new ChatMessageSchema();
  line.id = m.id;
  line.userId = m.userId;
  line.displayName = m.displayName;
  line.operationId = m.operationId;
  line.text = m.text;
  line.ts = m.ts;
  return line;
}
