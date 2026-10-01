/**
 * The services the office knows right now (#39): per henchman, the target the
 * proxy may reach and the listeners of the last scan. This is the proxy's
 * allowlist: it only ever connects to a (host, port) found here, and the host
 * comes from the runner, never from a request (no open proxy, no SSRF).
 */
import { type ServiceState, servicesProxyPath } from "@regulus/protocol";
import type { Listener, ServiceTarget } from "./discovery.ts";

export interface KnownService extends Listener {
  id: string;
  title: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface HenchmanServices {
  agentId: string;
  operationId: string;
  ownerUserId: string;
  /** Null when the office cannot reach the henchman's ports at all (e.g. docker without sandboxes). */
  target: ServiceTarget | null;
  services: Map<number, KnownService>;
}

/** A service the proxy may forward to. */
export interface ProxyableService {
  agentId: string;
  operationId: string;
  ownerUserId: string;
  port: number;
  /** Null: not reachable (localhost only, or no target). */
  target: ServiceTarget | null;
  localOnly: boolean;
}

export class ServiceRegistry {
  readonly #henchmen = new Map<string, HenchmanServices>();

  get(agentId: string): HenchmanServices | undefined {
    return this.#henchmen.get(agentId);
  }

  set(henchman: HenchmanServices): void {
    this.#henchmen.set(henchman.agentId, henchman);
  }

  delete(agentId: string): HenchmanServices | undefined {
    const henchman = this.#henchmen.get(agentId);
    this.#henchmen.delete(agentId);
    return henchman;
  }

  agentIds(): string[] {
    return [...this.#henchmen.keys()];
  }

  /** The service on `port` of henchman `agentId`, when the last scan saw it listening. */
  find(agentId: string, port: number): ProxyableService | undefined {
    const henchman = this.#henchmen.get(agentId);
    const svc = henchman?.services.get(port);
    if (!henchman || !svc) return undefined;
    return {
      agentId,
      operationId: henchman.operationId,
      ownerUserId: henchman.ownerUserId,
      port,
      target: svc.localOnly ? null : henchman.target,
      localOnly: svc.localOnly,
    };
  }

  /** The protocol view of an operation's services, ordered by henchman and port. */
  servicesOn(operationId: string, shared: (agentId: string) => boolean): ServiceState[] {
    const out: ServiceState[] = [];
    for (const henchman of this.#henchmen.values()) {
      if (henchman.operationId !== operationId) continue;
      for (const s of henchman.services.values()) {
        out.push({
          id: s.id,
          agentId: henchman.agentId,
          port: s.port,
          url: servicesProxyPath(operationId, henchman.agentId, s.port),
          title: s.title,
          pid: s.pid,
          address: s.address,
          localOnly: s.localOnly,
          shared: shared(henchman.agentId),
          firstSeenAt: s.firstSeenAt,
          lastSeenAt: s.lastSeenAt,
        });
      }
    }
    return out.sort((a, b) => a.agentId.localeCompare(b.agentId) || a.port - b.port);
  }
}
