// End-to-end check of the Compose runner wiring (#104): run it inside the office container, where
// DOCKER_HOST points at docker-proxy and the OFFICE_DOCKER_* / OFFICE_RUNNER_* variables come from
// deploy/docker-compose.yml. The runner image must already exist (build-only profile).
//
//   docker compose exec -T office bun run - < runner-e2e.ts
//
// Through the real docker runner backend (apps/server/src/runners/docker, SPEC §8) it provisions
// a runner for a throwaway human, mounts that human's own area on an operation from the shared
// worktrees volume (#114: never the operation mirror), runs the fake agent in tmux with a fake API
// key and a hook file, and checks:
//   - the pane shows the agent and the key reached it without appearing anywhere else
//   - the hook URL is OFFICE_RUNNER_OFFICE_URL and the runner reaches the office there
//   - the runner cannot reach docker-proxy (by name or IP) or Caddy
//   - uid 1001 can commit in an office-created worktree of the human's own clone (group 1001,
//     setgid dirs) and cannot see the operation mirror
// then removes the runner, its HOME volume and the operation dirs.
import { lookup } from "node:dns/promises";
import { chmod, mkdir, readFile, rm, stat } from "node:fs/promises";
import { loadConfig } from "/app/apps/server/src/config.ts";
import { DockerRunner } from "/app/apps/server/src/runners/docker/docker-runner.ts";
import { runnerId } from "/app/apps/server/src/runners/layout.ts";
import { FakeAdapter, type RunnerContext, Secret } from "/app/packages/agent-adapters/src/index.ts";

process.umask(0o002); // as the office's CMD does (deploy/office.Dockerfile)
const config = loadConfig();
const d = config.docker;
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const user = { userId: `e2e-${suffix}` };
const agentId = `e2e-${suffix}`;
const operation = `e2e-${suffix}`;
const mirror = `/srv/office/projects/${operation}/repo`;
// The human's own area on the operation, their clone of the repo and the agent's worktree (#114).
const area = `/srv/office/worktrees/${operation}/${runnerId(user.userId)}`;
const repo = `${area}/_clones/repo`;
const worktree = `${area}/${agentId}`;
const fakeKey = `sk-e2e-${crypto.randomUUID()}`;
const failures: string[] = [];

function check(ok: boolean, label: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
}

function git(...args: string[]): string {
  const id = ["-c", "user.name=Office E2E", "-c", "user.email=e2e@example.invalid"];
  const res = Bun.spawnSync(["git", ...id, ...args], { stderr: "pipe" });
  if (res.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr.toString()}`);
  return res.stdout.toString();
}

console.log(
  `image ${d.image}, network ${d.network}, prefix ${d.prefix}, user ${d.user}, ` +
    `office for runners ${config.runnerOfficeUrl}`,
);
check(Boolean(d.network), "OFFICE_DOCKER_RUNNER_NETWORK is set");
check(d.volumeMap.length === 2, "OFFICE_DOCKER_VOLUME_MAP maps projects and worktrees");

const runner = new DockerRunner({
  image: d.image,
  prefix: d.prefix,
  user: d.user,
  home: d.home,
  network: d.network,
  memoryBytes: d.memoryBytes,
  nanoCpus: d.cpus ? Math.round(d.cpus * 1e9) : undefined,
  pidsLimit: d.pidsLimit,
  operationRoots: d.operationRoots,
  volumeMap: d.volumeMap,
  labels: { "org.regulus.office.e2e": "1" },
  pull: false,
});

async function inRunner(cmd: string[], workdir?: string) {
  const { containerId } = await runner.provision(user);
  return runner.engine.exec(containerId as string, { cmd, workdir });
}

try {
  // The office clones the operation mirror, gives the human their own clone of it and adds the
  // agent's worktree, as #30/#31/#114 do.
  await mkdir(`/srv/office/projects/${operation}`, { recursive: true });
  git("init", "-q", "-b", "main", mirror);
  await Bun.write(`${mirror}/README.md`, "e2e\n");
  git("-C", mirror, "add", "README.md");
  git("-C", mirror, "commit", "-qm", "initial");
  await mkdir(`${area}/_clones`, { recursive: true });
  await chmod(area, (await stat(area)).mode & 0o7770);
  git("clone", "-q", "--no-local", "--config", "core.sharedRepository=group", mirror, repo);
  git("-C", repo, "worktree", "add", "-q", "-b", agentId, worktree);
  for (const dir of [`/srv/office/worktrees/${operation}`, area, repo]) {
    const s = await stat(dir);
    const shared = s.gid === 1001 && (s.mode & 0o2070) === 0o2070;
    check(
      shared,
      `${dir} is group 1001, setgid, group-writable (${(s.mode & 0o7777).toString(8)})`,
    );
  }
  check(((await stat(area)).mode & 0o007) === 0, `${area} is closed to other`);

  await runner.mountProject(user, { operationId: operation, repoId: "repo", workdir: worktree });
  const handle = await runner.provision(user);
  const info = (await runner.engine.json("GET", `/containers/${handle.containerId}/json`)) as {
    Config: { User: string; Env: string[] };
    HostConfig: { Mounts: { Type: string; Source: string; Target: string }[] };
    NetworkSettings: { Networks: Record<string, unknown> };
  };
  const networks = Object.keys(info.NetworkSettings.Networks);
  check(networks.join() === d.network, `runner is only on ${d.network} (${networks.join()})`);
  check(info.Config.User === d.user, `runner runs as ${d.user}`);
  const mounts = info.HostConfig.Mounts.map((m) => `${m.Type}:${m.Source}->${m.Target}`);
  console.log(`     mounts: ${mounts.join(", ")}`);
  const operationMounts = info.HostConfig.Mounts.filter((m) => m.Target !== d.home);
  check(
    operationMounts.length === 1 &&
      operationMounts[0]?.Type === "volume" &&
      operationMounts[0].Target === area,
    "only the human's own area is mounted, from the shared worktrees volume",
  );
  const mirrorSeen = await inRunner(["test", "-e", mirror]);
  check(mirrorSeen.code !== 0, "the operation mirror is not visible in the runner");
  check(!mounts.some((m) => m.includes("docker.sock")), "no Docker socket in the runner");

  const id = await inRunner(["id"]);
  check(/uid=1001\b.*gid=1001\b/.test(id.stdout), `runner identity: ${id.stdout.trim()}`);
  const tools = await inRunner(["sh", "-c", "bun --version && command -v tmux git gh curl"]);
  check(
    tools.code === 0,
    `bun, tmux, git, gh, curl usable by uid 1001 (bun ${tools.stdout.split("\n")[0]})`,
  );

  // The fake agent, spawned the way AgentManager (#26) will: adapter plan -> runner.exec.
  const fakeAgentPath = `${d.home}/.office/fake-agent.sh`;
  const adapter = new FakeAdapter({ command: ["sh", fakeAgentPath] });
  const ctx: RunnerContext = {
    backend: "docker",
    userId: user.userId,
    home: d.home,
    runner: {} as RunnerContext["runner"],
    officeUrl: config.runnerOfficeUrl,
    agentToken: Secret.of(`tok-${crypto.randomUUID()}`),
    now: Date.now,
  };
  const plan = adapter.buildSpawn(
    {
      agentId,
      provider: "custom",
      workdir: worktree,
      credential: { kind: "api_key", apiKey: Secret.of(fakeKey), attributedTo: "user" },
    },
    ctx,
  );
  const script = await readFile("/app/apps/server/src/runners/testing/fake-agent.sh", "utf8");
  const session = await runner.exec(user, {
    ...plan,
    files: [...plan.files, { path: fakeAgentPath, contents: script, mode: 0o755 }],
  });
  let pane = "";
  for (let i = 0; i < 50 && !pane.includes("FAKE AGENT READY"); i++) {
    await Bun.sleep(200);
    pane = await runner.capturePane(session, 50);
  }
  check(pane.includes("FAKE AGENT READY"), "fake agent is running in tmux");
  check(pane.includes("key=present") && !pane.includes(fakeKey), "API key reached the agent only");
  await runner.sendKeys(session, "hello from the office", { enter: true });
  for (let i = 0; i < 25 && !pane.includes("you said: hello"); i++) {
    await Bun.sleep(200);
    pane = await runner.capturePane(session, 50);
  }
  console.log(pane.trimEnd().replace(/^/gm, "     | "));
  check(pane.includes("you said: hello from the office"), "send-keys round trip");
  const inspected = JSON.stringify(
    await runner.engine.json("GET", `/containers/${handle.containerId}/json`),
  );
  check(!inspected.includes(fakeKey), "API key not in docker inspect");

  // Hooks: the adapter wrote the office URL for runners; the runner must reach it.
  const hookFile = await runner.readTextFile(user, `${d.home}/.fake-agent/${agentId}.json`);
  const hookUrl = new URL((JSON.parse(hookFile ?? "{}") as { hookUrl?: string }).hookUrl ?? "");
  check(hookUrl.origin === new URL(config.runnerOfficeUrl).origin, `hook URL ${hookUrl.href}`);
  const health = await inRunner(["curl", "-fsS", "--max-time", "10", `${hookUrl.origin}/healthz`]);
  check(
    health.code === 0 && health.stdout.includes("ok"),
    `runner -> office /healthz: ${health.stdout.trim()}`,
  );

  // Isolation: nothing but the office on the runners network.
  const proxyIp = (await lookup("docker-proxy")).address;
  for (const target of [
    "http://docker-proxy:2375/_ping",
    `http://${proxyIp}:2375/_ping`,
    "http://caddy:80/",
  ]) {
    const res = await inRunner(["curl", "-sS", "--max-time", "5", target]);
    check(res.code !== 0, `runner cannot reach ${target} (curl exit ${res.code})`);
  }

  // Shared storage: uid 1001 commits in the office-created worktree (objects land in the human's
  // clone's shared .git), and the office sees the commit.
  const commit = await inRunner(
    [
      "sh",
      "-c",
      "echo from-runner > runner.txt && git add runner.txt && " +
        "git -c user.name=runner -c user.email=runner@example.invalid commit -qm from-runner && " +
        `touch ${area}/_clones/runner-was-here`,
    ],
    worktree,
  );
  check(commit.code === 0, `runner commits in the worktree ${commit.stderr.trim()}`);
  check(
    git("-C", repo, "log", "--oneline", agentId).includes("from-runner"),
    "office sees the runner's commit",
  );

  await runner.kill({ userId: user.userId, agentId });
  check(!(await runner.sessionExists(session)), "agent session killed");
} catch (e) {
  check(false, `unexpected error: ${(e as Error).stack ?? e}`);
} finally {
  await runner
    .deprovision(user, { removeHome: true })
    .catch((e) => check(false, `deprovision: ${e}`));
  for (const dir of [`/srv/office/projects/${operation}`, `/srv/office/worktrees/${operation}`]) {
    await rm(dir, { recursive: true, force: true }).catch((e) => check(false, `rm ${dir}: ${e}`));
  }
  const left = (await runner.engine.json("GET", "/containers/json", {
    query: { all: true, filters: JSON.stringify({ label: ["org.regulus.office.e2e=1"] }) },
  })) as unknown[];
  check(left.length === 0, "no e2e runner containers left");
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("runner e2e: all checks passed");
// Exit explicitly: pooled Engine API sockets can otherwise keep the event loop alive.
process.exit(0);
