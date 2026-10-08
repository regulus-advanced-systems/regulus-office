/**
 * Integration: the real Hermes image (hermes-runner/Dockerfile) started by
 * `DockerHermesHost` on a real Docker daemon (#57). It shows that the pinned
 * Hermes starts as the office starts it (non-root, no capabilities, the
 * gateway in an exec with the keys in that exec's environment), answers
 * `/health`, takes the key the office made up, has the session chat the
 * office needs, and that its home survives a restart.
 *
 * No model is ever called: the model key is a dummy and no message is sent.
 *
 * Opt-in: REGULUS_HERMES_IMAGE=<image tag> (CI job `hermes-image`). Everything
 * it creates is labelled `regulus-test=1`, named `rghermes-<random>-…` and
 * removed in afterAll.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Secret } from "@regulus/agent-adapters";
import { EngineClient } from "../../../runners/docker/engine.ts";
import { HermesClient, HermesError } from "../client.ts";
import { hermesSetup } from "./config.ts";
import { DEFAULT_HERMES_LIMITS, DockerHermesHost } from "./docker-host.ts";
import { HERMES_GATEWAY_COMMAND, HERMES_IMAGE_HOME } from "./from-config.ts";
import { HERMES_ENV, type HermesProcess } from "./host.ts";

const image = process.env.REGULUS_HERMES_IMAGE ?? "";
const engine = new EngineClient();
const enabled = image !== "" && (await engine.ping());
if (image && !enabled) throw new Error("REGULUS_HERMES_IMAGE is set but Docker is not reachable");

const suffix = Math.random().toString(36).slice(2, 8);
const PREFIX = `rghermes-${suffix}`;
const AGENT = "a1";
const API_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef";
const MODEL_KEY = "sk-ant-integration-DUMMY-never-used-0000";
const OFFICE_TOKEN = "roa_integration-DUMMY-office-token-0000";

const host = new DockerHermesHost(engine, {
  image,
  prefix: PREFIX,
  user: "1001:1001",
  home: HERMES_IMAGE_HOME,
  ...DEFAULT_HERMES_LIMITS,
  command: HERMES_GATEWAY_COMMAND,
  labels: { "regulus-test": "1" },
  pull: false,
});

function launch(): Promise<HermesProcess> {
  const setup = hermesSetup({
    agent: { model: "haiku" },
    credential: { kind: "api_key", apiKey: Secret.of(MODEL_KEY), attributedTo: "office" },
    keyKind: "anthropic",
    // Nothing listens there: Hermes must come up without its MCP server.
    office: { mcpUrl: "http://127.0.0.1:9/mcp", token: Secret.of(OFFICE_TOKEN) },
  });
  return host.launch({
    agentId: AGENT,
    env: { ...setup.env, [HERMES_ENV.enabled]: "true", [HERMES_ENV.key]: API_KEY },
    files: setup.files,
  });
}

async function healthy(url: string, ms = 120_000): Promise<{ version?: string }> {
  const client = new HermesClient({ url, token: Secret.of(API_KEY) });
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      return await client.probe();
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await Bun.sleep(500);
    }
  }
}

const inspect = (name: string) =>
  engine.json<{
    Config: { Env: string[]; User: string };
    HostConfig: { CapDrop: string[]; Mounts: Array<{ Source: string; Target: string }> };
  }>("GET", `/containers/${name}/json`);

afterAll(async () => {
  if (enabled) await host.forget(AGENT).catch(() => {});
});

describe.skipIf(!enabled)("the Hermes image, started as the office starts it", () => {
  test("starts, answers /health, takes the office's key, keeps its home; no key in the container", async () => {
    const first = await launch();
    const { version } = await healthy(first.url);
    expect(version).toBe("0.21.5");

    // The key the office made up is the gateway's; any other is refused.
    const wrong = new HermesClient({ url: first.url, token: Secret.of("not-the-key-0123456789") });
    const refused = await wrong.probe().catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(HermesError);
    expect((refused as HermesError).kind).toBe("auth");

    // A session can be made (no model is called for that), and it is in the home.
    const client = new HermesClient({ url: first.url, token: Secret.of(API_KEY) });
    const sessionId = await client.createSession("Regulus Office: integration");
    expect(await client.sessionExists(sessionId)).toBe(true);

    // Non-root, nothing but its own volume, and no key in what `docker inspect` shows.
    const info = await inspect(host.containerName(AGENT));
    expect(info.Config.User).toBe("1001:1001");
    expect(info.HostConfig.CapDrop).toEqual(["ALL"]);
    expect(info.HostConfig.Mounts).toEqual([
      expect.objectContaining({ Source: host.volumeName(AGENT), Target: HERMES_IMAGE_HOME }),
    ]);
    const shown = JSON.stringify(info);
    for (const secret of [API_KEY, MODEL_KEY, OFFICE_TOKEN]) expect(shown).not.toContain(secret);
    const who = await engine.exec(host.containerName(AGENT), {
      cmd: ["sh", "-c", "id -u; cat .hermes/config.yaml"],
    });
    expect(who.stdout.startsWith("1001\n")).toBe(true);
    expect(who.stdout).toContain("Bearer ${OFFICE_AGENT_TOKEN}");
    expect(who.stdout).not.toContain(OFFICE_TOKEN);

    // Killed from inside, as a crash: the office learns of it.
    await engine.exec(host.containerName(AGENT), { cmd: ["sh", "-c", "pkill -9 -f 'hermes' || kill -9 -1"] });
    const exit = await Promise.race([first.exited, Bun.sleep(20_000).then(() => null)]);
    expect(exit).not.toBeNull();

    // Started again on the same home: Hermes still knows the session.
    const second = await launch();
    await healthy(second.url);
    const again = new HermesClient({ url: second.url, token: Secret.of(API_KEY) });
    expect(await again.sessionExists(sessionId)).toBe(true);

    await second.stop();
    const gone = await inspect(host.containerName(AGENT)).catch(() => null);
    expect(gone).toBeNull();
  }, 300_000);
});
