/**
 * The services the office knows right now (#39): per robot, the target the
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

export interface RobotServices {
  agentId: string;
  floorId: string;
  ownerUserId: string;
  /** Null when the office cannot reach the robot's ports at all (e.g. docker without sandboxes). */
  target: ServiceTarget | null;
  services: Map<number, KnownService>;
}

/** A service the proxy may forward to. */
export interface ProxyableService {
  agentId: string;
  floorId: string;
  ownerUserId: string;
  port: number;
  /** Null: not reachable (localhost only, or no target). */
  target: ServiceTarget | null;
  localOnly: boolean;
}

export class ServiceRegistry {
  readonly #robots = new Map<string, RobotServices>();

  get(agentId: string): RobotServices | undefined {
    return this.#robots.get(agentId);
  }

  set(robot: RobotServices): void {
    this.#robots.set(robot.agentId, robot);
  }

  delete(agentId: string): RobotServices | undefined {
    const robot = this.#robots.get(agentId);
    this.#robots.delete(agentId);
    return robot;
  }

  agentIds(): string[] {
    return [...this.#robots.keys()];
  }

  /** The service on `port` of robot `agentId`, when the last scan saw it listening. */
  find(agentId: string, port: number): ProxyableService | undefined {
    const robot = this.#robots.get(agentId);
    const svc = robot?.services.get(port);
    if (!robot || !svc) return undefined;
    return {
      agentId,
      floorId: robot.floorId,
      ownerUserId: robot.ownerUserId,
      port,
      target: svc.localOnly ? null : robot.target,
      localOnly: svc.localOnly,
    };
  }

  /** The protocol view of a floor's services, ordered by robot and port. */
  servicesOn(floorId: string, shared: (agentId: string) => boolean): ServiceState[] {
    const out: ServiceState[] = [];
    for (const robot of this.#robots.values()) {
      if (robot.floorId !== floorId) continue;
      for (const s of robot.services.values()) {
        out.push({
          id: s.id,
          agentId: robot.agentId,
          port: s.port,
          url: servicesProxyPath(floorId, robot.agentId, s.port),
          title: s.title,
          pid: s.pid,
          address: s.address,
          localOnly: s.localOnly,
          shared: shared(robot.agentId),
          firstSeenAt: s.firstSeenAt,
          lastSeenAt: s.lastSeenAt,
        });
      }
    }
    return out.sort((a, b) => a.agentId.localeCompare(b.agentId) || a.port - b.port);
  }
}
