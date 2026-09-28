/**
 * Boot wiring for credential profiles (SPEC §8): the spawn dialog's list
 * (list.ts), the "Connect providers" panel's key profiles (write-routes.ts)
 * and CLI logins (login-routes.ts).
 *
 *   const panel = mountCredentialPanel(server.router, {
 *     db, auth, keyring, runner, adapters: agents.adapters,
 *     logins: terminals.logins, officeUrl, logger,
 *   });
 *   shutdown.register("provider-logins", () => panel.shutdown());
 */
import type { AdapterRegistry } from "@regulus/agent-adapters";
import type { RateLimitRule } from "../auth/rate-limit.ts";
import type { Db } from "../db/index.ts";
import type { Router } from "../http/router.ts";
import type { Logger } from "../logging.ts";
import type { Runner } from "../runners/types.ts";
import type { MasterKeyring } from "../secrets/index.ts";
import type { LoginSessionTargets } from "../terminals/login-sessions.ts";
import type { CliCommands } from "./cli-status.ts";
import type { CredentialAuth } from "./http.ts";
import { mountCredentialProfileRoutes } from "./list.ts";
import { LoginFlows } from "./login-flows.ts";
import { mountLoginRoutes } from "./login-routes.ts";
import { KeyProfileService } from "./profiles.ts";
import { createKeyVerifier, type KeyVerifier } from "./verify.ts";
import { mountKeyProfileRoutes } from "./write-routes.ts";

export interface CredentialPanelDeps {
  db: Db;
  auth: CredentialAuth;
  keyring: MasterKeyring | undefined;
  runner: Runner;
  adapters: Pick<AdapterRegistry, "get">;
  logins: LoginSessionTargets;
  /** Office URL as seen from runners (only used to build a RunnerContext). */
  officeUrl: string;
  logger: Logger;
  verify?: KeyVerifier;
  commands?: CliCommands;
  limits?: { verify?: RateLimitRule; loginStart?: RateLimitRule };
  now?: () => number;
}

export interface CredentialPanel {
  profiles: KeyProfileService;
  flows: LoginFlows;
  shutdown(): Promise<void>;
}

export function mountCredentialPanel(router: Router, deps: CredentialPanelDeps): CredentialPanel {
  const profiles = new KeyProfileService({
    db: deps.db,
    keyring: deps.keyring,
    verify: deps.verify ?? createKeyVerifier(),
    logger: deps.logger,
    now: deps.now,
  });
  const flows = new LoginFlows({
    db: deps.db,
    runner: deps.runner,
    adapters: deps.adapters,
    logins: deps.logins,
    officeUrl: deps.officeUrl,
    logger: deps.logger,
    commands: deps.commands,
    now: deps.now,
  });
  // The spawn dialog's read-only list (#29's contract): GET /api/credential-profiles.
  mountCredentialProfileRoutes(router, { auth: deps.auth, db: deps.db });
  mountKeyProfileRoutes(router, {
    auth: deps.auth,
    profiles,
    verifyLimit: deps.limits?.verify,
    now: deps.now,
  });
  mountLoginRoutes(router, {
    auth: deps.auth,
    flows,
    startLimit: deps.limits?.loginStart,
    now: deps.now,
  });
  return { profiles, flows, shutdown: () => flows.shutdown() };
}
