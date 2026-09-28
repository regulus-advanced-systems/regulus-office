/**
 * In-memory `RunnerContext` for adapter unit tests: no tmux, no processes.
 * Records keystrokes, serves scripted pane text / titles / files.
 */
import type { PipedProcess, RunnerContext, RunnerOps, SpawnPlan } from "../types.ts";

export interface FakeRunnerOps extends RunnerOps {
  /** Every `sendKeys` call, in order. */
  readonly keys: { session: string; keys: string; enter: boolean }[];
  /** Plans passed to `spawnPiped`. */
  readonly piped: SpawnPlan[];
  /** Pane text per session returned by `capturePane`. */
  readonly panes: Map<string, string>;
  readonly titles: Map<string, string>;
  /** Runner filesystem: absolute path → contents. */
  readonly files: Map<string, string>;
}

export function createFakeRunnerOps(
  spawnPiped?: (plan: SpawnPlan) => Promise<PipedProcess>,
): FakeRunnerOps {
  const ops: FakeRunnerOps = {
    keys: [],
    piped: [],
    panes: new Map(),
    titles: new Map(),
    files: new Map(),
    async sendKeys(session, keys, opts) {
      ops.keys.push({ session, keys, enter: opts?.enter ?? false });
    },
    async capturePane(session, lines) {
      const text = ops.panes.get(session) ?? "";
      return text.split("\n").slice(-lines).join("\n");
    },
    async paneTitle(session) {
      return ops.titles.get(session) ?? "";
    },
    async spawnPiped(plan) {
      ops.piped.push(plan);
      if (!spawnPiped) throw new Error("FakeRunnerOps: spawnPiped not scripted");
      return spawnPiped(plan);
    },
    async readTextFile(path) {
      return ops.files.get(path) ?? null;
    },
    async listDir(path) {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const names = new Set<string>();
      for (const file of ops.files.keys()) {
        if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split("/")[0] as string);
      }
      return [...names].sort();
    },
  };
  return ops;
}

export function createFakeRunnerContext(
  overrides: Partial<Omit<RunnerContext, "runner">> & { runner?: RunnerOps } = {},
): RunnerContext & { runner: RunnerOps } {
  let clock = 1_700_000_000_000;
  return {
    backend: "linux-user",
    userId: "u1",
    home: "/home/office-u-u1",
    officeUrl: "http://office.test",
    now: () => clock++,
    ...overrides,
    runner: overrides.runner ?? createFakeRunnerOps(),
  };
}
