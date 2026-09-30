/**
 * Targeted delivery of pending permission requests (SPEC §8 rule 4, D12).
 *
 * A request says exactly what the agent wants to run or change, so it goes
 * only to clients that may control the robot: its owner (D12, #138), never
 * office admins/owners, other members or viewers, who only watch. It is sent as
 * `agent.permissions` when the list changes and again to a controller who
 * joins while requests are open. An empty list clears the robot's requests.
 * Everyone keeps seeing the public `RobotState.handRaised`.
 */
import {
  AGENT_PERMISSIONS_MESSAGE,
  type AgentPermissions,
  mayControlRobot,
  mayEmergencyStop,
  type PendingPermission,
} from "@regulus/protocol";
import type { RoomClient } from "../transport.ts";

interface Held {
  ownerUserId: string;
  requests: PendingPermission[];
}

export function mayControl(client: RoomClient, ownerUserId: string): boolean {
  return mayControlRobot({ id: client.user.userId, role: client.user.role }, ownerUserId);
}

/** Office owners/admins may emergency-stop any robot they can see (D12, #138). */
export function mayEmergencyStopAs(client: RoomClient): boolean {
  return mayEmergencyStop({ id: client.user.userId, role: client.user.role });
}

export class FloorPermissions {
  readonly #byFloor = new Map<string, Map<string, Held>>();

  /** Record a robot's current requests and send them to its controllers in `clients`. */
  set(
    floorId: string,
    agentId: string,
    ownerUserId: string,
    requests: PendingPermission[],
    clients: readonly RoomClient[],
  ): void {
    let floor = this.#byFloor.get(floorId);
    const had = floor?.get(agentId);
    if (requests.length === 0) {
      if (!had) return;
      floor?.delete(agentId);
      if (floor?.size === 0) this.#byFloor.delete(floorId);
    } else {
      if (!floor) {
        floor = new Map();
        this.#byFloor.set(floorId, floor);
      }
      floor.set(agentId, { ownerUserId, requests: [...requests] });
    }
    const message: AgentPermissions = { agentId, requests: [...requests] };
    for (const client of clients) {
      if (mayControl(client, ownerUserId)) client.send(AGENT_PERMISSIONS_MESSAGE, message);
    }
  }

  /** Forget a robot that left the floor; its controllers get an empty list. */
  drop(floorId: string, agentId: string, clients: readonly RoomClient[]): void {
    const held = this.#byFloor.get(floorId)?.get(agentId);
    if (held) this.set(floorId, agentId, held.ownerUserId, [], clients);
  }

  /** Everything open on the floor that `client` may answer (sent on join). */
  sendOpen(floorId: string, client: RoomClient): void {
    for (const [agentId, held] of this.#byFloor.get(floorId) ?? []) {
      if (!mayControl(client, held.ownerUserId)) continue;
      const message: AgentPermissions = { agentId, requests: [...held.requests] };
      client.send(AGENT_PERMISSIONS_MESSAGE, message);
    }
  }
}
