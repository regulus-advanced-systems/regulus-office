/**
 * `DockerHermesHost` against the fake Docker daemon (#57): what container a
 * managed Hermes gets (hardening, its own volume and nothing else, no key in
 * its configuration), that the gateway and its keys live in an exec, and
 * stop, forget, reap and a missing image.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EngineClient } from "../../../runners/docker/engine.ts";
import { type FakeContainer, FakeEngine } from "../../../runners/docker/testing/fake-engine.ts";
import { DEFAULT_HERMES_LIMITS, DockerHermesHost, type DockerHermesSettings } from "./docker-host.ts";
import { HERMES_GATEWAY_COMMAND, HERMES_IMAGE_HOME } from "./from-config.ts";
import { HermesHostError, type HermesLaunch } from "./host.ts";

const IMAGE = "regulus-office-hermes:test";
const API_KEY = "api-key-0123456789abcdef-DO-NOT-LEAK";
const MODEL_KEY = "sk-ant-DO-NOT-LEAK-0123456789";

let fake: FakeEngine;
let written: Map<string, string>;
/** Ends the gateway exec of the fake with this exit code. */
let endGateway: (code: number) => void;

const spec = (agentId = "a1"): HermesLaunch => ({
  agentId,
  env: { API_SERVER_ENABLED: "true", API_SERVER_KEY: API_KEY, ANTHROPIC_API_KEY: MODEL_KEY },
  files: [{ path: "config.yaml", contents: "model:\n  provider: anthropic\n" }],
});

function hostOf(over: Partial<DockerHermesSettings> = {}): DockerHermesHost {
  return new DockerHermesHost(new EngineClient(fake.dockerHost), {
    image: IMAGE,
    prefix: "office",
    user: "1001:1001",
    home: HERMES_IMAGE_HOME,
    network: "office_runners",
    ...DEFAULT_HERMES_LIMITS,
    command: HERMES_GATEWAY_COMMAND,
    ...over,
  });
}

const containerOf = (name: string): FakeContainer | undefined =>
  [...fake.containers.values()].find((c) => c.name === name);

beforeEach(async () => {
  fake = await FakeEngine.start();
  fake.images.add(IMAGE);
  written = new Map();
  fake.onExec = async (exec, io) => {
    const [bin, ...args] = exec.cmd;
    const script = args[1] ?? "";
    if (bin === "sh" && script.includes("head -c")) {
      const [path = "", size = "0"] = args.slice(3);
      written.set(path, new TextDecoder().decode(await io.readStdin(Number(size))));
      return 0;
    }
    if (bin === "sh" && script.includes("office-pid:")) {
      io.stderr("office-pid:42\n");
      const code = await new Promise<number>((resolve) => {
        endGateway = resolve;
      });
      io.stderr("Traceback: something broke\n");
      return code;
    }
    return 0;
  };
});

afterEach(async () => {
  endGateway?.(0);
  await fake.stop();
});

describe("a managed Hermes container", () => {
  test("is hardened like a sandbox, mounts only its own home, and holds no key", async () => {
    const host = hostOf();
    const process = await host.launch(spec());
    // Reached by name on the runners network; nothing is published on the host.
    expect(process.url).toBe("http://office-hermes-a1:8642");

    const container = containerOf("office-hermes-a1");
    expect(container?.running).toBe(true);
    const body = container?.body as Record<string, unknown>;
    const hostConfig = body.HostConfig as Record<string, unknown>;
    expect(body.Image).toBe(IMAGE);
    expect(body.User).toBe("1001:1001");
    expect(body.Cmd).toEqual(["sleep", "infinity"]);
    expect(hostConfig).toMatchObject({
      Init: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      NetworkMode: "office_runners",
      RestartPolicy: { Name: "no" },
      Memory: DEFAULT_HERMES_LIMITS.memoryBytes,
      MemorySwap: DEFAULT_HERMES_LIMITS.memoryBytes,
      PidsLimit: DEFAULT_HERMES_LIMITS.pids,
    });
    // Its own home volume and nothing else: no operation, no human's HOME, no socket.
    expect(hostConfig.Mounts).toEqual([
      { Type: "volume", Source: "office-hermes-home-a1", Target: "/home/hermes" },
    ]);
    expect(hostConfig.Binds).toBeUndefined();
    expect(hostConfig.PortBindings).toBeUndefined();
    expect(hostConfig.Privileged).toBeUndefined();
    expect(fake.volumes.has("office-hermes-home-a1")).toBe(true);
    expect(body.Labels).toMatchObject({
      "org.regulus.office.role": "hermes",
      "org.regulus.office.prefix": "office",
      "org.regulus.office.hermes-agent": "a1",
    });

    // No key anywhere in what the daemon stores about the container.
    const stored = JSON.stringify(body);
    expect(stored).not.toContain(API_KEY);
    expect(stored).not.toContain(MODEL_KEY);

    // The configuration is written into the home through stdin, never argv.
    expect(written.get("/home/hermes/.hermes/config.yaml")).toContain("provider: anthropic");
    // The gateway runs in an exec, and the keys are that exec's environment.
    const gateway = [...fake.execs.values()].find((e) => e.cmd.includes("gateway"));
    expect(gateway?.cmd.slice(-3)).toEqual([...HERMES_GATEWAY_COMMAND]);
    expect(gateway?.env).toEqual(
      expect.arrayContaining([
        `API_SERVER_KEY=${API_KEY}`,
        `ANTHROPIC_API_KEY=${MODEL_KEY}`,
        "HERMES_HOME=/home/hermes/.hermes",
        "API_SERVER_HOST=0.0.0.0",
        "API_SERVER_PORT=8642",
      ]),
    );
    for (const exec of fake.execs.values()) {
      expect(exec.cmd.join(" ")).not.toContain(API_KEY);
      expect(exec.cmd.join(" ")).not.toContain(MODEL_KEY);
    }
    await process.stop();
  });

  test("the end of the gateway is reported with its code and what it printed last", async () => {
    const process = await hostOf().launch(spec());
    endGateway(3);
    const exit = await process.exited;
    expect(exit.code).toBe(3);
    expect(exit.tail).toContain("something broke");
  });

  test("stop removes the container and keeps the home; a new start replaces what is there", async () => {
    const host = hostOf();
    const first = await host.launch(spec());
    const firstId = containerOf("office-hermes-a1")?.id;
    const second = await host.launch(spec());
    expect(containerOf("office-hermes-a1")?.id).not.toBe(firstId);
    expect(fake.containers.size).toBe(1);
    await second.stop();
    await first.stop();
    expect(fake.containers.size).toBe(0);
    expect(fake.volumes.has("office-hermes-home-a1")).toBe(true);
  });

  test("forget removes the container and the home; reap stops only this office's gateways", async () => {
    const host = hostOf();
    await host.launch(spec("a1"));
    await host.launch(spec("a2"));
    await hostOf({ prefix: "other" }).launch(spec("a1"));
    await host.forget("a1");
    expect(containerOf("office-hermes-a1")).toBeUndefined();
    expect(fake.volumes.has("office-hermes-home-a1")).toBe(false);
    expect(fake.volumes.has("office-hermes-home-a2")).toBe(true);
    // Forgetting an agent that never had a Hermes is not an error.
    await host.forget("never-there");

    await host.reap();
    expect(containerOf("office-hermes-a2")).toBeUndefined();
    expect(containerOf("other-hermes-a1")?.running).toBe(true);
    expect(fake.volumes.has("office-hermes-home-a2")).toBe(true);
  });

  test("a missing image is a reason the operator can act on, and leaves nothing behind", async () => {
    const host = hostOf({ image: "not-built:1", pull: false });
    const err = await host.launch(spec()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HermesHostError);
    expect((err as Error).message).toContain("not-built:1 is not on the Docker host");
    expect(fake.containers.size).toBe(0);
  });

  test("an agent id that could leave the name is refused", async () => {
    const host = hostOf();
    await expect(host.launch(spec("../x"))).rejects.toThrow();
    await expect(host.forget("a b")).rejects.toThrow();
  });
});
