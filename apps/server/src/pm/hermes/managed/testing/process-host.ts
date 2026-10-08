/**
 * A managed Hermes as a plain local process (#57), for tests: it starts the
 * given command (the fake gateway, `fake-gateway-main.ts`) with a home
 * directory per agent under `root`, on a free port of 127.0.0.1. No isolation
 * at all: never used outside tests.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import {
  HERMES_ENV,
  HermesHostError,
  type HermesLaunch,
  type HermesProcess,
  type ManagedHermesHost,
  tailOf,
} from "../host.ts";

export const FAKE_GATEWAY_COMMAND: readonly string[] = [
  process.execPath,
  join(import.meta.dir, "fake-gateway-main.ts"),
];

const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export interface ProcessHostOptions {
  /** Homes live in `<root>/<agentId>`. */
  root: string;
  command?: readonly string[];
}

export class ProcessHermesHost implements ManagedHermesHost {
  /** Every launch so far, with what it was handed (tests read the keys back from here). */
  readonly launches: HermesLaunch[] = [];
  /** Extra environment for the next launches (the fake's `FAKE_HERMES_*` switches). */
  extraEnv: Record<string, string> = {};
  /** Set: `launch` refuses with this reason, as a host without its image does. */
  unavailable: string | undefined;
  readonly #children = new Map<string, ReturnType<typeof Bun.spawn>>();

  constructor(private readonly options: ProcessHostOptions) {}

  home(agentId: string): string {
    if (!AGENT_ID.test(agentId)) throw new Error("agent id not usable as a directory name");
    return join(this.options.root, agentId);
  }

  /** Whether the agent's gateway process is alive. */
  running(agentId: string): boolean {
    const child = this.#children.get(agentId);
    return child !== undefined && child.exitCode === null && child.signalCode === null;
  }

  /** Kill the gateway as the kernel would (tests: a crash); `SIGSTOP` makes it hang instead. */
  kill(agentId: string, signal: NodeJS.Signals = "SIGKILL"): void {
    this.#children.get(agentId)?.kill(signal);
  }

  async launch(spec: HermesLaunch): Promise<HermesProcess> {
    if (this.unavailable) throw new HermesHostError(this.unavailable);
    this.launches.push(spec);
    await this.#stop(spec.agentId);
    const home = this.home(spec.agentId);
    await mkdir(home, { recursive: true });
    for (const file of spec.files) {
      const path = join(home, file.path);
      if (!path.startsWith(`${home}/`)) throw new Error("file outside the Hermes home");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.contents, { mode: 0o600 });
    }
    const port = await freePort();
    const child = Bun.spawn([...(this.options.command ?? FAKE_GATEWAY_COMMAND)], {
      // Only what it is handed: nothing of the test's own environment but PATH.
      env: {
        PATH: process.env.PATH ?? "",
        ...this.extraEnv,
        ...spec.env,
        [HERMES_ENV.home]: home,
        [HERMES_ENV.host]: "127.0.0.1",
        [HERMES_ENV.port]: `${port}`,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.#children.set(spec.agentId, child);
    const out = tailOf(child.stdout);
    const err = tailOf(child.stderr);
    return {
      url: `http://127.0.0.1:${port}`,
      exited: child.exited.then((code) => ({
        code: child.signalCode ? null : code,
        tail: err() || out(),
      })),
      stop: async () => {
        child.kill("SIGKILL");
        await child.exited;
      },
    };
  }

  async forget(agentId: string): Promise<void> {
    await this.#stop(agentId);
    await rm(this.home(agentId), { recursive: true, force: true });
  }

  async reap(): Promise<void> {
    for (const agentId of [...this.#children.keys()]) await this.#stop(agentId);
  }

  async #stop(agentId: string): Promise<void> {
    const child = this.#children.get(agentId);
    if (!child) return;
    this.#children.delete(agentId);
    child.kill("SIGKILL");
    await child.exited;
  }
}
