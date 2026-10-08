/**
 * Targeted delivery of pending permission requests (SPEC §8 rule 4, D12).
 *
 * A request says exactly what the agent wants to run or change, so it goes
 * only to clients that may control the henchman: its owner (D12, #138), never
 * office admins/owners, other members or viewers, who only watch. It is sent as
 * `agent.permissions` when the list changes and again to a controller who
 * joins while requests are open. An empty list clears the henchman's requests.
 * Everyone keeps seeing the public `HenchmanState.handRaised`.
 */
import {
  AGENT_PERMISSIONS_MESSAGE,
  type AgentPermissions,
  mayControlHenchman,
  mayEmergencyStop,
  type PendingPermission,
} from "@regulus/protocol";
import type { RoomClient } from "../transport.ts";

interface Held {
  ownerUserId: string;
  requests: PendingPermission[];
}

export function mayControl(client: RoomClient, ownerUserId: string): boolean {
  return mayControlHenchman({ id: client.user.userId, role: client.user.role }, ownerUserId);
}

/**
 * Office owners/admins may emergency-stop any henchman they can see (D12, #138). In a room
 * they cannot see they stop by person instead (agents/manager/emergency-routes.ts, #270).
 */
export function mayEmergencyStopAs(client: RoomClient): boolean {
  return mayEmergencyStop({ id: client.user.userId, role: client.user.role });
}

export class OperationPermissions {
  readonly #byOperation = new Map<string, Map<string, Held>>();

  /** Record a henchman's current requests and send them to its controllers in `clients`. */
  set(
    operationId: string,
    agentId: string,
    ownerUserId: string,
    requests: PendingPermission[],
    clients: readonly RoomClient[],
  ): void {
    let operation = this.#byOperation.get(operationId);
    const had = operation?.get(agentId);
    if (requests.length === 0) {
      if (!had) return;
      operation?.delete(agentId);
      if (operation?.size === 0) this.#byOperation.delete(operationId);
    } else {
      if (!operation) {
        operation = new Map();
        this.#byOperation.set(operationId, operation);
      }
      operation.set(agentId, { ownerUserId, requests: [...requests] });
    }
    const message: AgentPermissions = { agentId, requests: [...requests] };
    for (const client of clients) {
      if (mayControl(client, ownerUserId)) client.send(AGENT_PERMISSIONS_MESSAGE, message);
    }
  }

  /** Forget a henchman that left the operation; its controllers get an empty list. */
  drop(operationId: string, agentId: string, clients: readonly RoomClient[]): void {
    const held = this.#byOperation.get(operationId)?.get(agentId);
    if (held) this.set(operationId, agentId, held.ownerUserId, [], clients);
  }

  /** Everything open on the operation that `client` may answer (sent on join). */
  sendOpen(operationId: string, client: RoomClient): void {
    for (const [agentId, held] of this.#byOperation.get(operationId) ?? []) {
      if (!mayControl(client, held.ownerUserId)) continue;
      const message: AgentPermissions = { agentId, requests: [...held.requests] };
      client.send(AGENT_PERMISSIONS_MESSAGE, message);
    }
  }
}
