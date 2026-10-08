/**
 * Office agents in the world, as this viewer sees them (#252): the bodies of
 * the level they are looking at (from the BuildingRoom state), what each of
 * their agents wants from them (`OfficeAgentAttention`, their own only, read
 * over REST), the bubble that follows from both, and which agent's chat
 * window is open.
 *
 * Who may open a chat is the protocol's `mayTalkToOfficeAgent`, the rule the
 * server enforces: a personal agent's owner, and members and above for a
 * shared one. For everyone else the body is something to look at.
 */
import {
  AGENT_BUBBLE_MAX_TEXT,
  type AgentBubble,
  type BuildingState,
  LOBBY_LEVEL_ID,
  mayTalkToOfficeAgent,
  type OfficeAgentAttentionEntry,
  type OfficeAgentBody,
  type OfficeAgentStatus,
  type UserRole,
} from "@regulus/protocol";
import { create } from "zustand";

export interface Viewer {
  id: string;
  role: UserRole;
}

/** The bodies on one level, oldest agent first (a stable order for drawing). */
export function bodiesOnLevel(
  state: Pick<BuildingState, "officeAgents"> | null | undefined,
  levelId: string,
): OfficeAgentBody[] {
  return Object.values(state?.officeAgents ?? {})
    .filter((b) => (b.levelId || LOBBY_LEVEL_ID) === levelId)
    .sort((a, b) => a.agentId.localeCompare(b.agentId));
}

export const isOwnBody = (body: Pick<OfficeAgentBody, "ownerUserId">, viewer: Viewer | null) =>
  !!viewer && body.ownerUserId !== "" && body.ownerUserId === viewer.id;

/** May this viewer open its chat? */
export function canChatWith(
  body: Pick<OfficeAgentBody, "ownerUserId">,
  viewer: Viewer | null,
): boolean {
  return !!viewer && mayTalkToOfficeAgent(viewer, { ownerUserId: body.ownerUserId || null });
}

/** Whose it is, in a few words: under its name in the chat window, and over it for other people. */
export function bodyCaption(
  body: Pick<OfficeAgentBody, "ownerUserId" | "ownerName">,
  viewer: Viewer | null,
): string {
  if (body.ownerUserId === "") return "Office agent";
  if (isOwnBody(body, viewer)) return "Your assistant";
  return `${body.ownerName || "Someone"}'s assistant`;
}

const clip = (text: string) =>
  text.length <= AGENT_BUBBLE_MAX_TEXT ? text : `${text.slice(0, AGENT_BUBBLE_MAX_TEXT - 1)}…`;

/**
 * The bubble over a body for this viewer (the shared `AgentBubble`, #256):
 * a question it asked them, an answer they have not read, the answer it is
 * working on; else, for someone else's personal agent, whose it is and
 * nothing of what it does; else where it stands. `standing` is false while it walks.
 */
export function bodyBubble(
  body: Pick<OfficeAgentBody, "agentId" | "ownerUserId" | "ownerName" | "doing">,
  attention: OfficeAgentAttentionEntry | undefined,
  viewer: Viewer | null,
  standing: boolean,
): AgentBubble | null {
  const conversation = { targetKind: "conversation", targetId: body.agentId } as const;
  if (attention && canChatWith(body, viewer)) {
    if (attention.question !== undefined) {
      return {
        kind: "needs_you",
        text: clip(attention.question || "has a question"),
        ...conversation,
      };
    }
    if (attention.unread) {
      return { kind: "answer_ready", text: "has an answer for you", ...conversation };
    }
    if (attention.waiting) {
      return { kind: "doing", text: "working on your answer", ...conversation };
    }
  }
  if (body.ownerUserId !== "" && !isOwnBody(body, viewer)) {
    return {
      kind: "doing",
      text: clip(bodyCaption(body, viewer)),
      targetKind: "none",
      targetId: "",
    };
  }
  if (standing && body.doing) {
    return { kind: "doing", text: clip(body.doing), targetKind: "none", targetId: "" };
  }
  return null;
}

/** The status light: an office agent's status in a henchman's terms. */
export function bodyLight(status: OfficeAgentStatus) {
  switch (status) {
    case "busy":
      return "working" as const;
    case "starting":
      return "starting" as const;
    case "error":
      return "error" as const;
    case "stopped":
      return "offline" as const;
    default:
      return "idle" as const;
  }
}

// ---- What my agents want from me ---------------------------------------------------

export interface AttentionStore {
  byAgent: Readonly<Record<string, OfficeAgentAttentionEntry>>;
  set: (entries: readonly OfficeAgentAttentionEntry[]) => void;
}

export const useAgentAttention = create<AttentionStore>()((set) => ({
  byAgent: {},
  set: (entries) => set({ byAgent: Object.fromEntries(entries.map((e) => [e.agentId, e])) }),
}));

// ---- The chat window in the world ---------------------------------------------------

export interface AgentChatWindowStore {
  /** The office agent whose chat is open as a window in the world. */
  agentId: string | null;
  /**
   * What is known of it when its body is not in this viewer's state: the office PM asked
   * for at the reception desk while its round has it in a room closed to them (#60).
   */
  known: OfficeAgentBody | null;
  open: (agentId: string, known?: OfficeAgentBody) => void;
  close: () => void;
}

export const useAgentChatWindow = create<AgentChatWindowStore>()((set) => ({
  agentId: null,
  known: null,
  open: (agentId, known) => set({ agentId, known: known ?? null }),
  close: () => set({ agentId: null, known: null }),
}));

/**
 * Open the chat with a body, if this viewer may. Returns false (and opens
 * nothing) for someone else's personal agent or a viewer without the right.
 */
export function openBodyChat(
  body: Pick<OfficeAgentBody, "agentId" | "ownerUserId">,
  viewer: Viewer | null,
): boolean {
  if (!canChatWith(body, viewer)) return false;
  useAgentChatWindow.getState().open(body.agentId);
  return true;
}

/** The nearest of `bodies` within `radius` metres of a point, for `E`. */
export function nearestBody<T extends { x: number; z: number }>(
  bodies: readonly T[],
  at: { x: number; z: number },
  radius: number,
): T | null {
  let best: T | null = null;
  let bestD = radius;
  for (const b of bodies) {
    const d = Math.hypot(b.x - at.x, b.z - at.z);
    if (d <= bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}
