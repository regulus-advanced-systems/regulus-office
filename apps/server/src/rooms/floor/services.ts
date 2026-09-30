/**
 * Running apps in the FloorRoom state (SPEC §6 channel 2, §9.4; #39): the dev
 * servers robots on the floor run in their sandboxes, published by the
 * services scanner (services/scanner.ts). Keyed by service id; only changed
 * fields are written, so an unchanged list produces no patch.
 */
import { ServiceState, ServiceStateSchema } from "@regulus/protocol";
import type { FloorRoomState } from "./state.ts";

type ServiceSchema = InstanceType<typeof ServiceStateSchema>;

/** Validate a floor's services against the protocol shape (throws on a bad one). */
export function parseServices(services: readonly ServiceState[]): ServiceState[] {
  return services.map((s) => ServiceState.parse(s));
}

function writeService(target: ServiceSchema, s: ServiceState): ServiceSchema {
  if (target.id !== s.id) target.id = s.id;
  if (target.agentId !== s.agentId) target.agentId = s.agentId;
  if (target.port !== s.port) target.port = s.port;
  if (target.url !== s.url) target.url = s.url;
  if (target.title !== s.title) target.title = s.title;
  if (target.pid !== s.pid) target.pid = s.pid;
  if (target.address !== s.address) target.address = s.address;
  if (target.localOnly !== s.localOnly) target.localOnly = s.localOnly;
  if (target.shared !== s.shared) target.shared = s.shared;
  if (target.firstSeenAt !== s.firstSeenAt) target.firstSeenAt = s.firstSeenAt;
  if (target.lastSeenAt !== s.lastSeenAt) target.lastSeenAt = s.lastSeenAt;
  return target;
}

/** Make `state.services` equal `services`. */
export function syncServices(state: FloorRoomState, services: readonly ServiceState[]): void {
  const next = new Map(services.map((s) => [s.id, s]));
  for (const key of [...state.services.keys()]) if (!next.has(key)) state.services.delete(key);
  for (const [key, s] of next) {
    const existing = state.services.get(key);
    if (existing) writeService(existing, s);
    else state.services.set(key, writeService(new ServiceStateSchema(), s));
  }
}
