/**
 * #114: two humans on one floor never share a git directory. Human A's agent
 * plants a hook, `core.fsmonitor`, an `include.path` and a filter driver in
 * the git dir of its own worktree (as a prompt-injected agent could); human
 * B's agent then runs git in its own worktree. Nothing A planted may run for
 * B, and B's clone must be untouched. As a control, A's own git does run it.
 *
 * Real AgentManager + GitWorktreeWorkspaces + LocalTmuxRunner, with the floor
 * cloned from a local bare repo over file://. LocalTmuxRunner runs every
 * "human" as the same OS user, so this proves the git-level separation; the
 * filesystem separation between runners is checked by the docker and
 * linux-user integration tests.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAdapter } from "@regulus/agent-adapters";
import { and, eq } from "drizzle-orm";
import { agents, desks } from "../../db/schema/index.ts";
import type { FloorActor } from "../../floors/access.ts";
import { runnerId } from "../../runners/layout.ts";
import { hasTmux, LocalTmuxRunner, shellQuote } from "../../runners/testing/local-tmux-runner.ts";
import { git, setupFloor } from "../../worktrees/test-helpers.ts";
import { LEGACY_WORKSPACE_MESSAGE, WorkspaceError } from "../../worktrees/types.ts";
import { AgentManagerError } from "./errors.ts";
import { makeManager } from "./test-helpers.ts";

let root: string;
let runner: LocalTmuxRunner | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "office-isolation-"));
});
afterAll(async () => {
  await runner?.dispose();
  await rm(root, { recursive: true, force: true });
});

async function waitForFile(path: string, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await Bun.file(path).exists())) {
    if (Date.now() > deadline) {
      const errors = await readFile(join(path, "..", "err.log"), "utf8").catch(() => "");
      throw new Error(`timed out waiting for ${path}: ${errors}`);
    }
    await Bun.sleep(50);
  }
}

/** Everything A's agent plants, each one logging `<kind>:<cwd>` when git runs it. */
const PLANT = (log: string) => `
set -e
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
common=$(git rev-parse --path-format=absolute --git-common-dir)
mkdir -p "$common/hooks" "$common/info"
for h in post-checkout pre-commit post-commit reference-transaction post-index-change; do
  printf '#!/bin/sh\\necho "hook-%s:$PWD" >> ${log}\\n' "$h" > "$common/hooks/$h"
  chmod +x "$common/hooks/$h"
done
git config core.fsmonitor 'echo "fsmonitor:$PWD" >> ${log}; false'
cat > "$common/evil.inc" <<'INC'
[filter "evil"]
  clean = "sh -c 'echo filter:$PWD >> ${log}; cat'"
INC
git config include.path "$common/evil.inc"
echo '* filter=evil' > "$common/info/attributes"
# Control: A's own git runs what A planted.
echo a > a.txt
git status --short >/dev/null
git add a.txt
git -c user.name=A -c user.email=a@example.invalid commit -qm a
`;

/** B's agent: ordinary git work in its own worktree. */
const WORK = `
set -e
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
git status --short >/dev/null
echo b > b.txt
git add b.txt
git -c user.name=B -c user.email=b@example.invalid commit -qm b
git checkout -q -b scratch-b
git checkout -q -
`;

describe.skipIf(!hasTmux())("per-human clones (#114)", () => {
  test("a hook, fsmonitor, include.path or filter planted by A's agent never runs for B", async () => {
    const f = await setupFloor(root);
    const bob = f.addUser("Bob", "admin");
    runner = await LocalTmuxRunner.create();
    const scripts = join(root, `scripts-${Date.now()}`);
    const log = join(scripts, "ran.log");
    expect(log).toMatch(/^[\w/.-]+$/); // used unquoted in the planted config
    await mkdir(scripts, { recursive: true });
    const ridA = runnerId(f.owner.id);
    const ridB = runnerId(bob.id);
    // Each agent runs `<scripts>/<its owner's runner id>.sh`, then leaves a done file.
    await writeFile(
      join(scripts, `${ridA}.sh`),
      `${PLANT(log)}\ntouch ${shellQuote(`${scripts}/done-a`)}\n`,
    );
    await writeFile(
      join(scripts, `${ridB}.sh`),
      `${WORK}\ntouch ${shellQuote(`${scripts}/done-b`)}\n`,
    );
    const command = [
      "sh",
      "-c",
      `sh ${shellQuote(scripts)}/"$(basename "$(dirname "$PWD")")".sh 2>> ${shellQuote(`${scripts}/err.log`)}; exec sleep 600`,
    ];
    const { manager } = makeManager(f.db, runner, [new FakeAdapter({ command })], {
      workspaces: f.worktrees.workspaces,
      clones: f.worktrees.workspaces,
    });
    const spawn = (actor: FloorActor, taskTitle: string) =>
      manager.spawn(actor, {
        floorId: f.floorId,
        repoId: f.repo.repoId,
        provider: "custom",
        model: "fake-1",
        prompt: "go",
        taskTitle,
        autoWorktree: true,
      });

    const a = await spawn(f.owner, "Plant things");
    await waitForFile(join(scripts, "done-a"));
    // B's clone did not exist yet: it is seeded from the mirror, not from A's clone.
    const cloneB = f.cloneOf(bob.id);
    const b = await spawn(bob, "Honest work");
    await waitForFile(join(scripts, "done-b"));

    const row = (id: string) => f.db.select().from(agents).where(eq(agents.id, id)).get();
    const workA = row(a.agentId)?.workdir ?? "";
    const workB = row(b.agentId)?.workdir ?? "";
    expect(workA).toBe(join(f.areaOf(), a.agentId));
    expect(workB).toBe(join(f.areaOf(bob.id), b.agentId));
    expect(ridA).not.toBe(ridB);

    // Control: the planted things are real and ran for A.
    const ran = (await readFile(log, "utf8")).split("\n").filter(Boolean);
    expect(ran.some((l) => l.startsWith("hook-") && l.endsWith(workA))).toBe(true);
    expect(ran.some((l) => l.startsWith("fsmonitor:") && l.endsWith(workA))).toBe(true);
    expect(ran.some((l) => l.startsWith("filter:"))).toBe(true);
    // Nothing ran for B: every line comes from A's worktree.
    expect(ran.filter((l) => !l.endsWith(workA))).toEqual([]);

    // B's clone is exactly as the office made it.
    const configB = await readFile(join(cloneB, ".git", "config"), "utf8");
    expect(configB).not.toMatch(/fsmonitor|include|filter/i);
    expect(
      await git(["config", "--file", join(cloneB, ".git", "config"), "remote.origin.url"]),
    ).toBe(f.repo.remoteUrl);
    const hooksB = await readdir(join(cloneB, ".git", "hooks")).catch(() => []);
    expect(hooksB.filter((h) => !h.endsWith(".sample"))).toEqual([]);
    expect(await Bun.file(join(cloneB, ".git", "info", "attributes")).exists()).toBe(false);
    // B's work landed in B's clone only.
    const logB = await git(["-C", cloneB, "log", "--format=%s", "-1", `office/honest-work`]);
    expect(logB).toBe("b");
    const inA = git(["-C", f.cloneOf(), "rev-parse", "--verify", "office/honest-work"]);
    await expect(inA).rejects.toThrow();
    // The mirror never saw either agent's git.
    const mirrorTrees = await git(["-C", f.repo.workdir, "worktree", "list"]);
    expect(mirrorTrees).not.toContain(workA);
    expect(mirrorTrees).not.toContain(workB);
    const mirrorConfig = await readFile(join(f.repo.workdir, ".git", "config"), "utf8");
    expect(mirrorConfig).not.toMatch(/fsmonitor|include|filter/i);

    // The office refuses its own credentialed git in A's tampered clone, and B's still works.
    const err = await f.worktrees.workspaces.status(a.agentId).catch((e) => e);
    expect(err).toBeInstanceOf(WorkspaceError);
    expect(err.message).toMatch(/core\.fsmonitor|include\.path/);
    expect((await f.worktrees.workspaces.status(b.agentId)).uncommitted).toEqual([]);
    await manager.close();
  }, 60_000);

  test("an agent from before per-human clones goes offline, cannot resume, keeps PR and send-home", async () => {
    const f = await setupFloor(root);
    runner = await LocalTmuxRunner.create();
    // A pre-#114 worktree of the shared mirror, directly in the floor dir, with a commit.
    const agentId = f.addAgent("agent-legacy", { taskTitle: "Old work" });
    const legacy = join(f.worktreesDir, "wt-floor", agentId);
    await mkdir(join(f.worktreesDir, "wt-floor"), { recursive: true });
    await git(["-C", f.repo.workdir, "worktree", "add", "-q", "-b", "office/old", legacy, "trunk"]);
    await writeFile(join(legacy, "old.md"), "old\n");
    await git(["-C", legacy, "add", "old.md"]);
    await git(["-C", legacy, "commit", "-qm", "old work"]);
    f.db
      .update(agents)
      .set({ workdir: legacy, worktreeBranch: "office/old", status: "idle", provider: "custom" })
      .where(eq(agents.id, agentId))
      .run();
    const seat = f.db.select().from(desks).where(eq(desks.floorId, f.floorId)).get();
    f.db
      .update(desks)
      .set({ agentId })
      .where(and(eq(desks.floorId, f.floorId), eq(desks.seatId, seat?.seatId ?? "")))
      .run();

    const { manager, robots } = makeManager(f.db, runner, [new FakeAdapter({ command: ["sh"] })], {
      workspaces: f.worktrees.workspaces,
      clones: f.worktrees.workspaces,
    });
    await manager.adopt();
    expect(f.db.select().from(agents).where(eq(agents.id, agentId)).get()?.status).toBe("offline");
    expect(manager.store.events(agentId).map((e) => ("reason" in e ? e.reason : ""))).toContain(
      LEGACY_WORKSPACE_MESSAGE,
    );
    expect(robots.robots.get(agentId)?.status).toBe("offline");

    const err = await manager.resume(f.owner, agentId).catch((e) => e);
    expect(err).toBeInstanceOf(AgentManagerError);
    expect(err.message).toBe(LEGACY_WORKSPACE_MESSAGE);
    expect(await runner.listSessions({ userId: f.owner.id })).toEqual([]);

    // The office's own git still works on it (in the mirror), and send-home cleans it up.
    const ws = f.worktrees.workspaces;
    expect(
      ws.cloneFor({ ownerUserId: f.owner.id, repoId: f.repo.repoId, workdir: legacy }),
    ).toEqual({ clone: f.repo.workdir, legacy: true });
    expect((await ws.status(agentId)).uncommitted).toEqual([]);
    await manager.sendHome(f.owner, agentId, { keepBranch: true });
    expect(await Bun.file(join(legacy, ".git")).exists()).toBe(false);
    expect(await git(["-C", f.repo.workdir, "branch", "--list", "office/old"])).toContain(
      "office/old",
    );
    await manager.close();
  }, 30_000);
});
