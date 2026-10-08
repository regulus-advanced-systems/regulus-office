/** When the office offers "Hermes, run by the office" (#57): an image is named and agents run in Docker. */
import { describe, expect, test } from "bun:test";
import { loadConfig } from "../../../config.ts";
import { captureLogger } from "../../../notifications/testing.ts";
import { DockerHermesHost } from "./docker-host.ts";
import { managedHermesFromConfig } from "./from-config.ts";

const IMAGE = "regulus-office-hermes:0.21.5";

describe("the managed Hermes host from the office's configuration", () => {
  test("no image named: off, and nothing is said", () => {
    const log = captureLogger();
    const config = loadConfig({ OFFICE_RUNNER_BACKEND: "docker" });
    expect(managedHermesFromConfig(config, log.logger)).toBeUndefined();
    expect(log.text()).toBe("");
  });

  test("an image and the docker backend: containers of the runner's prefix, uid and network", () => {
    const log = captureLogger();
    const config = loadConfig({
      OFFICE_RUNNER_BACKEND: "docker",
      OFFICE_HERMES_IMAGE: IMAGE,
      OFFICE_HERMES_MEMORY: "1g",
      OFFICE_DOCKER_RUNNER_PREFIX: "lair",
      OFFICE_DOCKER_RUNNER_NETWORK: "lair_runners",
    });
    const host = managedHermesFromConfig(config, log.logger)?.host;
    expect(host).toBeInstanceOf(DockerHermesHost);
    expect((host as DockerHermesHost).settings).toMatchObject({
      image: IMAGE,
      prefix: "lair",
      user: "1001:1001",
      home: "/home/hermes",
      network: "lair_runners",
      memoryBytes: 1024 ** 3,
      cpus: 1,
      pids: 512,
      command: ["hermes", "gateway", "run"],
    });
    expect((host as DockerHermesHost).containerName("a1")).toBe("lair-hermes-a1");
    expect(log.text()).toContain("Hermes run by the office is on");
  });

  test("another backend cannot run it: off, and the log says why", () => {
    const log = captureLogger();
    const config = loadConfig({ OFFICE_RUNNER_BACKEND: "linux-user", OFFICE_HERMES_IMAGE: IMAGE });
    expect(managedHermesFromConfig(config, log.logger)).toBeUndefined();
    expect(log.text()).toContain("only the docker runner backend can run Hermes");
  });
});
