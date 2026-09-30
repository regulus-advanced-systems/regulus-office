import { afterAll, describe, expect, test } from "bun:test";
import type { RepoCredential } from "../github/repo-access.ts";
import { NotificationDirectory } from "./directory.ts";
import type { RobotSnapshot } from "./events.ts";
import { PrWatcher } from "./pr-watch.ts";
import { captureLogger, seededDb } from "./testing.ts";

const TOKEN = "ghs_fakeInstallationToken0123";
const pulls = new Map<string, { state: string; merged: boolean }>();
const seen: { path: string; auth: string | null }[] = [];
const gh = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const path = new URL(req.url).pathname;
    seen.push({ path, auth: req.headers.get("authorization") });
    const pull = pulls.get(path);
    return pull ? Response.json(pull) : new Response("{}", { status: 404 });
  },
});
afterAll(() => gh.stop(true));

function setup() {
  const seed = seededDb();
  seed.addAgent("a1", 1, seed.member.id, 11);
  seed.addAgent("a2", 2, seed.member.id, 22);
  seed.addAgent("a3", 1, seed.other.id, null);
  const merged: RobotSnapshot[] = [];
  const directory = new NotificationDirectory(seed.db);
  const log = captureLogger();
  const repoNames: Record<string, string> = { "repo-1": "web", "repo-2": "api" };
  const watcher = new PrWatcher({
    db: seed.db,
    directory,
    center: { pullRequestMerged: (robot) => merged.push(robot) },
    apiBase: `http://127.0.0.1:${gh.port}`,
    logger: log.logger,
    repos: {
      withRepoCredential: async (repoId, fn) =>
        fn({
          repo: { owner: "octo", name: repoNames[repoId] ?? "x" },
          token: TOKEN,
        } as unknown as RepoCredential),
    },
  });
  return { ...seed, watcher, merged, directory, log };
}

describe("PrWatcher", () => {
  test("notifies a merged robot PR once, also across restarts; closed PRs stop polling", async () => {
    pulls.clear();
    seen.length = 0;
    pulls.set("/repos/octo/web/pulls/11", { state: "open", merged: false });
    pulls.set("/repos/octo/api/pulls/22", { state: "closed", merged: false });
    const s = setup();
    await s.watcher.tick();
    expect(s.merged).toHaveLength(0);
    expect(seen.map((r) => r.path).sort()).toEqual([
      "/repos/octo/api/pulls/22",
      "/repos/octo/web/pulls/11",
    ]);
    expect(seen.every((r) => r.auth === `Bearer ${TOKEN}`)).toBe(true);

    pulls.set("/repos/octo/web/pulls/11", { state: "closed", merged: true });
    seen.length = 0;
    await s.watcher.tick();
    // The closed PR is not asked for again.
    expect(seen.map((r) => r.path)).toEqual(["/repos/octo/web/pulls/11"]);
    expect(s.merged.map((r) => [r.agentId, r.prNumber, r.ownerName, r.floorId])).toEqual([
      ["a1", 11, "Mia", "floor-1"],
    ]);

    await s.watcher.tick();
    expect(s.merged).toHaveLength(1);
    const restarted = new PrWatcher({
      db: s.db,
      directory: new NotificationDirectory(s.db),
      center: { pullRequestMerged: (robot) => s.merged.push(robot) },
      apiBase: `http://127.0.0.1:${gh.port}`,
      logger: s.log.logger,
      repos: { withRepoCredential: async () => "unknown" as never },
    });
    await restarted.tick();
    expect(s.merged).toHaveLength(1);
    expect(s.log.text()).not.toContain(TOKEN);
  });

  test("GitHub failures are quiet and retried next time", async () => {
    pulls.clear();
    const s = setup();
    await s.watcher.tick();
    expect(s.merged).toHaveLength(0);
    pulls.set("/repos/octo/api/pulls/22", { state: "closed", merged: true });
    await s.watcher.tick();
    expect(s.merged.map((r) => r.agentId)).toEqual(["a2"]);
  });
});
