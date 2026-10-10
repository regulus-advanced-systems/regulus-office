/** What `AgentWorld` is given and what it reports (#252, #60). */
import type { OfficeAgentPost, OfficeAgentStatus } from "@regulus/protocol";
import type { Lair } from "./geometry.ts";
import type { Route, RouteVisit } from "./route.ts";

/** An office agent as the world needs it. */
export interface WorldAgent {
  id: string;
  name: string;
  /** Null: a shared agent. */
  ownerUserId: string | null;
  ownerName: string;
  appearance: string;
  status: OfficeAgentStatus;
  dismissed: boolean;
  /**
   * Its home post: `reception` for the office PM (#60), its board for a board
   * helper (#56); left out or `none` for everyone else.
   */
  post?: OfficeAgentPost;
  /** The project room of a board post (its operation id). */
  postRoom?: string;
}

/** Where the owner of a visited henchman is while the agent stands next to it. */
export type OwnerWhereabouts = "in_the_room" | "elsewhere" | "away";

export interface DutyContext {
  lair: Lair;
  mayEnter(operationId: string): boolean;
  now: number;
}

export interface AgentWorldDeps {
  /** Every office agent, oldest first. */
  agents(): WorldAgent[];
  /** May this agent be in this project room right now? Asked often; keep it a lookup. */
  mayEnter(agentId: string, operationId: string): boolean;
  /**
   * Asked for an agent standing at its post, every step: a route to set off on
   * now (the office PM's round when one is due), or null to stay.
   */
  duty?(agent: WorldAgent, context: DutyContext): Route | null;
  /** The agent has arrived next to a henchman its route sent it to. */
  standingBy?(agent: WorldAgent, visit: RouteVisit, owner: OwnerWhereabouts): void;
  random?: () => number;
}
