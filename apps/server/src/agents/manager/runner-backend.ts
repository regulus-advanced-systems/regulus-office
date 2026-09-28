/**
 * Runner backend selection from config (SPEC §8, D6): `docker` (Compose
 * default), `linux-user` (bare-install default), or `local`, a dev/test
 * backend over LocalTmuxRunner that runs agents as the office user with no
 * isolation, refused in production by config.ts and again here.
 */
import { join } from "node:path";
import type { OfficeConfig } from "../../config.ts";
import { DockerRunner } from "../../runners/docker/docker-runner.ts";
import { EngineClient } from "../../runners/docker/engine.ts";
import { LinuxUserRunner } from "../../runners/linux-user/linux-user-runner.ts";
import { LocalTmuxRunner } from "../../runners/testing/local-tmux-runner.ts";
import type { Runner } from "../../runners/types.ts";

export async function createRunner(
  config: Pick<OfficeConfig, "runnerBackend" | "docker" | "dataDir">,
  production: boolean,
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
        floorRoots: d.floorRoots,
        volumeMap: d.volumeMap,
      });
    }
    case "linux-user":
      return new LinuxUserRunner();
    case "local":
      if (production) throw new Error("the local runner backend is not allowed in production");
      return LocalTmuxRunner.open(join(config.dataDir, "local-runner"));
  }
}
