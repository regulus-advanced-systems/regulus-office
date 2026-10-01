/**
 * Runner backend selection from config (SPEC §8, D6): `docker` (Compose
 * default), `linux-user` (bare-install default), or `local`, a dev/test
 * backend over LocalTmuxRunner that runs agents as the office user with no
 * isolation, refused in production by config.ts and again here.
 */
import { join } from "node:path";
import type { OfficeConfig } from "../../config.ts";
import type { Logger } from "../../logging.ts";
import { DockerRunner } from "../../runners/docker/docker-runner.ts";
import { EngineClient } from "../../runners/docker/engine.ts";
import { LinuxUserRunner } from "../../runners/linux-user/linux-user-runner.ts";
import { LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import type { Runner } from "../../runners/types.ts";

export async function createRunner(
  config: Pick<OfficeConfig, "runnerBackend" | "docker" | "dataDir"> &
    Partial<Pick<OfficeConfig, "sandbox">>,
  production: boolean,
  logger?: Logger,
): Promise<Runner> {
  switch (config.runnerBackend) {
    case "docker": {
      const d = config.docker;
      return new DockerRunner({
        engine: new EngineClient(d.dockerHost),
        image: d.image,
        prefix: d.prefix,
        user: d.user,
        home: d.home,
        network: d.network,
        memoryBytes: d.memoryBytes,
        nanoCpus: d.cpus === undefined ? undefined : Math.round(d.cpus * 1e9),
        pidsLimit: d.pidsLimit,
        operationRoots: d.operationRoots,
        volumeMap: d.volumeMap,
        // Recreated broken or outdated runner containers (#151).
        logger: logger?.child({ component: "docker-runner" }),
        // One container per coding henchman (D18, #169).
        sandboxes: config.sandbox ?? undefined,
      });
    }
    case "linux-user":
      // One scope and network/pid namespace per coding henchman (D18, #169).
      return new LinuxUserRunner({
        sandboxes: config.sandbox ?? undefined,
        logger: logger?.child({ component: "linux-user-runner" }),
      });
    case "local":
      if (production) throw new Error("the local runner backend is not allowed in production");
      return LocalTmuxRunner.open(join(config.dataDir, "local-runner"));
  }
}
