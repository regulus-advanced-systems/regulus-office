/**
 * Running apps (SPEC §9.4, research 01 §12, #39): discovery of the dev servers
 * robots run in their sandboxes, the `services` table, the FloorRoom list and
 * the authenticated proxy. Design notes: docs/deploy/services-proxy.md.
 *
 * Config (read here, all optional):
 * - `OFFICE_SERVICES_DOMAIN`: app domain mode, e.g. `apps.office.example`
 *   (wildcard DNS and certificate needed). Unset: path mode, owner only.
 */
import type { ServiceState } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import type { OriginPolicy } from "../auth/origin.ts";
import type { Db } from "../db/index.ts";
import { userProfiles } from "../db/schema/index.ts";
import { floorAccessFor } from "../floors/access.ts";
import type { Logger } from "../logging.ts";
import type { Runner } from "../runners/types.ts";
import type { AppUser } from "./access.ts";
import { type AppDomain, AppTokens, appDomainFrom, appLabel } from "./app-domain.ts";
import { htmlTitle, type ServiceTarget } from "./discovery.ts";
import { ServiceRegistry } from "./registry.ts";
import { ServicesRoute } from "./route.ts";
import { ServiceScanner } from "./scanner.ts";
import { ServiceStore } from "./store.ts";

export interface ServicesOptions {
  db: Db;
  /** FloorRooms (#39 `publishServices`). */
  floors: { publishServices(floorId: string, services: readonly ServiceState[]): void };
  sessions: { getSessionFromRequest(request: Request): Promise<AppUser | null> };
  originPolicy: OriginPolicy;
  officePort: number;
  /** `OFFICE_SERVICES_DOMAIN`. */
  appDomain?: string;
  logger: Logger;
  intervalMs?: number;
}

export interface Services {
  /** The proxy; add it to the office's WsRouter before everything else. */
  route: ServicesRoute;
  registry: ServiceRegistry;
  appDomain: AppDomain | null;
  /** Start discovery on the office's runner (created after the HTTP server). */
  start(runner: Runner): ServiceScanner;
  stop(): Promise<void>;
}

const TITLE_PROBE_MS = 1_500;
const TITLE_PROBE_BYTES = 64 * 1024;

/** GET / on the service for its page title (never follows redirects). */
export async function probeTitle(target: ServiceTarget, port: number): Promise<string | null> {
  const host = target.host.includes(":") ? `[${target.host}]` : target.host;
  const res = await fetch(`http://${host}:${port}/`, {
    headers: { host: `localhost:${port}`, accept: "text/html" },
    redirect: "manual",
    signal: AbortSignal.timeout(TITLE_PROBE_MS),
  });
  if (!res.ok || !res.headers.get("content-type")?.includes("html") || !res.body) {
    await res.body?.cancel();
    return null;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < TITLE_PROBE_BYTES) {
    const { value, done } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return htmlTitle(new TextDecoder().decode(Buffer.concat(chunks)));
}

export function createServices(opts: ServicesOptions): Services {
  const appDomain = appDomainFrom(opts.appDomain, opts.originPolicy.publicUrl);
  const registry = new ServiceRegistry();
  const logger = opts.logger.child({ module: "services" });
  const shared = (agentId: string) => Boolean(appDomain && appLabel(agentId, 1));
  const userById = (id: string): AppUser | null => {
    const row = opts.db
      .select({ role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, id))
      .get();
    return row ? { id, role: row.role } : null;
  };
  const route = new ServicesRoute({
    registry,
    sessions: opts.sessions,
    userById,
    canViewFloor: (user, floorId) => floorAccessFor(opts.db, user, floorId) !== null,
    originPolicy: opts.originPolicy,
    officePort: opts.officePort,
    appDomain,
    tokens: new AppTokens(),
    logger,
  });
  logger.info(
    { mode: appDomain ? "app-domain" : "path", domain: appDomain?.domain },
    "services proxy ready",
  );
  let scanner: ServiceScanner | undefined;
  return {
    route,
    registry,
    appDomain,
    start(runner) {
      scanner ??= new ServiceScanner({
        db: opts.db,
        runner,
        registry,
        store: new ServiceStore(opts.db),
        publish: (floorId, list) => opts.floors.publishServices(floorId, list),
        shared,
        probeTitle,
        logger,
        intervalMs: opts.intervalMs,
      });
      scanner.start();
      return scanner;
    },
    stop: async () => scanner?.stop(),
  };
}
