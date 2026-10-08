/**
 * The managed Hermes host this office is configured for (#57), or none.
 *
 * It is on when the operator named a Hermes image (`OFFICE_HERMES_IMAGE`) and
 * the office runs its agents in Docker. The linux-user backend has no host
 * yet: there the choice stays greyed out in the agent form.
 */
import type { OfficeConfig } from "../../../config.ts";
import type { Logger } from "../../../logging.ts";
import { EngineClient } from "../../../runners/docker/engine.ts";
import { DEFAULT_HERMES_LIMITS, DockerHermesHost } from "./docker-host.ts";
import type { ManagedHermesHost } from "./host.ts";

/** HOME of the `hermes` user in hermes-runner/Dockerfile. */
export const HERMES_IMAGE_HOME = "/home/hermes";
/** The gateway in the foreground, as hermes-runner/Dockerfile's own CMD starts it. */
export const HERMES_GATEWAY_COMMAND: readonly string[] = ["hermes", "gateway", "run"];

export function managedHermesFromConfig(
  config: Pick<OfficeConfig, "hermes" | "runnerBackend" | "docker">,
  logger: Logger,
): { host: ManagedHermesHost } | undefined {
  if (!config.hermes) return undefined;
  if (config.runnerBackend !== "docker") {
    logger.warn(
      { backend: config.runnerBackend },
      "OFFICE_HERMES_IMAGE is set, but only the docker runner backend can run Hermes: it stays off",
    );
    return undefined;
  }
  const d = config.docker;
  const host = new DockerHermesHost(new EngineClient(d.dockerHost), {
    image: config.hermes.image,
    prefix: d.prefix,
    // The image's `hermes` user has the runner uid, so one setting covers both.
    user: d.user,
    home: HERMES_IMAGE_HOME,
    network: d.network,
    memoryBytes: config.hermes.memoryBytes ?? DEFAULT_HERMES_LIMITS.memoryBytes,
    cpus: config.hermes.cpus ?? DEFAULT_HERMES_LIMITS.cpus,
    pids: config.hermes.pids ?? DEFAULT_HERMES_LIMITS.pids,
    command: HERMES_GATEWAY_COMMAND,
  });
  logger.info({ image: config.hermes.image }, "Hermes run by the office is on");
  return { host };
}
