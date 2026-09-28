/**
 * Root typecheck gate: runs every workspace's `typecheck` script in parallel and
 * retries a workspace once when the native compiler crashes (issue #83). Type
 * errors are never retried. Exit code is non-zero if any workspace fails.
 *
 * Usage: bun scripts/typecheck/run.ts
 */
import { dirname, join, relative, resolve } from "node:path";
import { classifyRun, type RunOutcome } from "./classify.ts";

const ROOT = resolve(import.meta.dir, "../..");
const MAX_ATTEMPTS = 2;

interface Workspace {
  name: string;
  dir: string;
}

async function workspaces(): Promise<Workspace[]> {
  const root = await Bun.file(join(ROOT, "package.json")).json();
  const found: Workspace[] = [];
  for (const pattern of root.workspaces as string[]) {
    for await (const file of new Bun.Glob(`${pattern}/package.json`).scan({ cwd: ROOT })) {
      const pkg = await Bun.file(join(ROOT, file)).json();
      if (pkg.scripts?.typecheck) found.push({ name: pkg.name, dir: join(ROOT, dirname(file)) });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

async function runOnce(ws: Workspace): Promise<{ outcome: RunOutcome; output: string }> {
  const proc = Bun.spawn(["bun", "run", "typecheck"], {
    cwd: ws.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const output = `${out}${err}`;
  return { outcome: classifyRun(code, output), output };
}

async function check(ws: Workspace): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { outcome, output } = await runOnce(ws);
    if (outcome === "ok") {
      console.log(
        `${ws.name}: ok${attempt > 1 ? ` (after compiler crash, attempt ${attempt})` : ""}`,
      );
      return true;
    }
    if (outcome === "compiler_crash" && attempt < MAX_ATTEMPTS) {
      console.warn(`${ws.name}: tsc crashed (not a type error, see #83); retrying once`);
      continue;
    }
    const label = outcome === "compiler_crash" ? "tsc crashed again" : "type errors";
    console.error(`${ws.name}: ${label} in ${relative(ROOT, ws.dir)}\n${output.trimEnd()}`);
    return false;
  }
  return false;
}

const results = await Promise.all((await workspaces()).map(check));
if (results.includes(false)) process.exit(1);
