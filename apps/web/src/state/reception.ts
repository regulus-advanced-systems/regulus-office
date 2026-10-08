/**
 * The reception desk (SPEC §9.1, D28; #60): the office PM's home post, and
 * where anyone goes to talk to it. Walking up to the desk and pressing `E`
 * (or clicking the desk) opens the PM's chat, whether it is standing behind
 * the counter or out on its round.
 *
 * The PM is the body whose `post` is `reception`. While its round has it in a
 * room closed to this viewer its body is not in their state at all (#270), so
 * the desk then asks the office who the office PM is: the agent list every
 * signed-in person may read, which says the same thing the body would.
 */
import {
  type BuildingState,
  LOBBY_LEVEL_ID,
  LOBBY_OPERATION_ID,
  type OfficeAgentBody,
  type OfficeAgentView,
} from "@regulus/protocol";
import type { ToastInput } from "../ui/toast/toastQueue.ts";
import { canChatWith, useAgentChatWindow, type Viewer } from "./officeAgents.ts";

/** The office PM's body, when this viewer is sent it. */
export function receptionBody(
  state: Pick<BuildingState, "officeAgents"> | null | undefined,
): OfficeAgentBody | null {
  return Object.values(state?.officeAgents ?? {}).find((b) => b.post === "reception") ?? null;
}

/** Is it standing at its desk right now (as opposed to out on its round)? */
export const atReception = (body: Pick<OfficeAgentBody, "mode"> | null): boolean =>
  body?.mode === "post";

/** The office PM among the agents the office lists for this person. */
export function officePmOf(agents: readonly OfficeAgentView[]): OfficeAgentView | null {
  return agents.find((a) => a.owner.kind === "office" && a.role === "pm") ?? null;
}

/** A body for the chat window from the agent's card: enough to title it and to say whose it is. */
export function bodyOfView(view: OfficeAgentView): OfficeAgentBody {
  return {
    agentId: view.id,
    name: view.name,
    ownerUserId: "",
    ownerName: "",
    appearance: view.appearance,
    status: view.status,
    levelId: LOBBY_LEVEL_ID,
    operationId: LOBBY_OPERATION_ID,
    mode: "route",
    target: { x: 0, z: 0, heading: 0 },
    hop: 0,
    doing: "",
    dismissed: false,
    post: "reception",
  };
}

export const RECEPTION_EMPTY =
  "Nobody is at reception yet. An office owner or admin can add a project manager for the office in Settings → Agents.";
export const RECEPTION_VIEWER = "Viewers cannot talk to the office's project manager.";

export interface ReceptionDeps {
  state: Pick<BuildingState, "officeAgents"> | null | undefined;
  viewer: Viewer | null;
  /** The office's agent list (`GET /api/office-agents`); null when it could not be read. */
  agents(): Promise<readonly OfficeAgentView[] | null>;
  toast(input: ToastInput): void;
  open?: (agentId: string, known?: OfficeAgentBody) => void;
}

export type ReceptionResult = "opened" | "nobody" | "not_allowed" | "failed";

/** Someone at the desk asks for the office PM: open its chat, or say why not. */
export async function askAtReception(deps: ReceptionDeps): Promise<ReceptionResult> {
  const open = deps.open ?? useAgentChatWindow.getState().open;
  const refuse = (): ReceptionResult => {
    deps.toast({ kind: "info", message: RECEPTION_VIEWER });
    return "not_allowed";
  };
  const body = receptionBody(deps.state);
  if (body) {
    if (!canChatWith(body, deps.viewer)) return refuse();
    open(body.agentId);
    return "opened";
  }
  // Not in sight: there is none, or its round has it somewhere this viewer cannot look.
  const agents = await deps.agents();
  if (!agents) {
    deps.toast({ kind: "warning", message: "Reception could not be reached. Try again." });
    return "failed";
  }
  const pm = officePmOf(agents);
  if (!pm) {
    deps.toast({ kind: "info", message: RECEPTION_EMPTY });
    return "nobody";
  }
  if (!pm.canTalk) return refuse();
  open(pm.id, bodyOfView(pm));
  return "opened";
}
