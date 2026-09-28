import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FLOOR_TIERS, officeL2Template, PALETTES, smallTemplate } from "@regulus/floor-layout";
import { FLOOR_TEMPLATE_TIERS } from "@regulus/protocol";
import { eq } from "drizzle-orm";
import { AuthHttpError } from "../auth/errors.ts";
import { auditLog, desks, floorRepos } from "../db/schema/index.ts";
import { createLogger } from "../logging.ts";
import { createFloors, type Floors } from "./index.ts";
import { FAKE_PAT, makeBareRepo, testDb } from "./test-helpers.ts";

const logger = createLogger({ level: "silent" });
let root: string;
let remoteBase: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "office-floors-"));
  remoteBase = await makeBareRepo(join(root, "remotes"), "octo", "hello", "trunk");
  await makeBareRepo(join(root, "remotes"), "octo", "tools", "main");
  await makeBareRepo(join(root, "remotes"), "other", "tools", "main");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function setup(options: { keyring?: boolean } = {}) {
  const { db, addUser } = testDb();
  const changed: string[] = [];
  const keyring =
    options.keyring === false ? undefined : { current: 1, keys: { 1: randomBytes(32) } };
  const projectsDir = join(root, `projects-${crypto.randomUUID().slice(0, 8)}`);
  const floors: Floors = createFloors({
    db,
    logger,
    config: { projectsDir, githubRemoteBase: remoteBase },
    keyring,
    onChange: (id) => changed.push(id),
  });
  return {
    db,
    floors,
    changed,
    projectsDir,
    owner: addUser("Olga", "owner"),
    admin: addUser("Adam", "admin"),
    member: addUser("Mia", "member"),
    viewer: addUser("Vic", "viewer"),
  };
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof AuthHttpError) return `${err.status} ${err.code}`;
    throw err;
  }
  return "ok";
};

describe("FloorService", () => {
  test("protocol tiers match the layout package", () => {
    expect([...FLOOR_TEMPLATE_TIERS]).toEqual([...FLOOR_TIERS]);
  });

  test("an admin creates a floor: repos clone, desks come from the template", async () => {
    const t = setup();
    const { floor, cloned } = t.floors.service.create(t.admin, {
      name: "Apollo Moon",
      tier: "small",
      repos: [{ repo: "octo/hello", token: FAKE_PAT }, { repo: "https://github.com/octo/tools" }],
    });
    expect(floor).toMatchObject({
      name: "Apollo Moon",
      slug: "apollo-moon",
      index: 1,
      paletteId: PALETTES[1]?.id,
      layoutTemplateId: smallTemplate.id,
      access: "manage",
    });
    expect(floor.repos.map((r) => [r.owner, r.name, r.cloneStatus, r.isPrimary])).toEqual([
      ["octo", "hello", "cloning", true],
      ["octo", "tools", "cloning", false],
    ]);
    expect(floor.repos[0]?.hasCredential).toBe(true);
    expect(JSON.stringify(floor)).not.toContain(FAKE_PAT);
    expect(t.changed).toEqual([floor.floorId]);

    await cloned;
    const ready = t.floors.service.get(t.admin, floor.floorId);
    expect(ready.repos.map((r) => [r.cloneStatus, r.defaultBranch])).toEqual([
      ["ready", "trunk"],
      ["ready", "main"],
    ]);
    const workdir = join(t.projectsDir, "apollo-moon", "hello");
    expect((await stat(join(workdir, "README.md"))).isFile()).toBe(true);
    const gitConfig = await readFile(join(workdir, ".git", "config"), "utf8");
    expect(gitConfig).not.toContain(FAKE_PAT);
    // An office-only mirror (#114): humans get their own clones, nobody shares this one.
    expect(gitConfig).not.toMatch(/sharedRepository/i);

    const deskSeats = t.db.select().from(desks).where(eq(desks.floorId, floor.floorId)).all();
    const expected = smallTemplate.seats.filter((s) => s.kind === "desk").map((s) => s.id);
    expect(deskSeats.map((d) => d.seatId).sort()).toEqual([...expected].sort());

    const stored = t.db.select().from(floorRepos).all();
    for (const row of stored) expect(row.encryptedCredential ?? "").not.toContain(FAKE_PAT);
    const audit = t.db.select().from(auditLog).all();
    expect(audit.map((a) => a.action)).toContain("floor.create");
    expect(JSON.stringify(audit)).not.toContain(FAKE_PAT);
  });

  test("the seam hands the decrypted PAT, workdir and default branch to server-side git", async () => {
    const t = setup();
    const { floor, cloned } = t.floors.service.create(t.owner, {
      name: "Seam",
      tier: "medium",
      repos: [{ repo: "octo/hello", token: FAKE_PAT }],
    });
    await cloned;
    const repoId = floor.repos[0]?.repoId ?? "";
    const seen = await t.floors.repos.withRepoCredential(repoId, (c) => ({
      token: c.token,
      workdir: c.repo.workdir,
      branch: c.repo.defaultBranch,
      header: c.gitEnv.GIT_CONFIG_KEY_0,
      redacted: c.redact(`push with ${FAKE_PAT}`),
    }));
    expect(seen).toEqual({
      token: FAKE_PAT,
      workdir: join(t.projectsDir, "seam", "hello"),
      branch: "trunk",
      header: "http.extraHeader",
      redacted: "push with [redacted]",
    });
    expect(floor.layoutTemplateId).toBe(officeL2Template.id);
  });

  test("palettes cycle, slugs stay unique, same-named repos get owner-prefixed dirs", async () => {
    const t = setup();
    const a = t.floors.service.create(t.owner, {
      name: "Twin",
      tier: "small",
      repos: [{ repo: "octo/hello" }],
    });
    const b = t.floors.service.create(t.owner, {
      name: "Twin",
      tier: "small",
      paletteId: "teal-cream",
      repos: [{ repo: "octo/tools" }, { repo: "other/tools" }],
    });
    await Promise.all([a.cloned, b.cloned]);
    expect([a.floor.slug, b.floor.slug]).toEqual(["twin", "twin-2"]);
    expect([a.floor.paletteId, b.floor.paletteId]).toEqual([PALETTES[1]?.id ?? "", "teal-cream"]);
    const repos = t.floors.repos.listFloorRepos(b.floor.floorId);
    expect(repos.map((r) => r.workdir)).toEqual([
      join(t.projectsDir, "twin-2", "octo-tools"),
      join(t.projectsDir, "twin-2", "other-tools"),
    ]);
  });

  test("validation: roles, repo refs, duplicates, palette, PAT without a master key", () => {
    const t = setup();
    const create = (actor: typeof t.owner, repos: { repo: string; token?: string }[], extra = {}) =>
      code(() => t.floors.service.create(actor, { name: "X", tier: "small", repos, ...extra }));
    expect(create(t.member, [{ repo: "octo/hello" }])).toBe("403 owner_or_admin_required");
    expect(create(t.owner, [{ repo: "https://gitlab.com/o/r" }])).toBe("400 unsupported_host");
    expect(create(t.owner, [{ repo: "octo/hello" }, { repo: "OCTO/Hello" }])).toBe(
      "400 duplicate_repo",
    );
    expect(create(t.owner, [{ repo: "octo/hello" }], { paletteId: "nope" })).toBe(
      "400 unknown_palette",
    );
    const noKey = setup({ keyring: false });
    expect(
      code(() =>
        noKey.floors.service.create(noKey.owner, {
          name: "X",
          tier: "small",
          repos: [{ repo: "octo/hello", token: FAKE_PAT }],
        }),
      ),
    ).toBe("400 master_key_required");
  });

  test("a failed clone records a redacted error; retry with a new token recovers", async () => {
    const t = setup();
    const { floor, cloned } = t.floors.service.create(t.owner, {
      name: "Broken",
      tier: "small",
      repos: [{ repo: "octo/missing", token: FAKE_PAT }],
    });
    await cloned;
    const [repo] = t.floors.service.get(t.owner, floor.floorId).repos;
    expect(repo?.cloneStatus).toBe("error");
    expect(repo?.cloneError).toBeTruthy();
    expect(repo?.cloneError).not.toContain(FAKE_PAT);

    expect(
      code(() =>
        t.floors.service.retryClone(t.member, floor.floorId, repo?.repoId ?? "", undefined),
      ),
    ).toBe("404 floor_not_found");
    await makeBareRepo(join(root, "remotes"), "octo", "missing", "main");
    const retry = t.floors.service.retryClone(
      t.owner,
      floor.floorId,
      repo?.repoId ?? "",
      `${FAKE_PAT}2`,
    );
    expect(retry.repo.cloneStatus).toBe("cloning");
    await retry.cloned;
    expect(t.floors.service.get(t.owner, floor.floorId).repos[0]?.cloneStatus).toBe("ready");
    await t.floors.repos.withRepoCredential(repo?.repoId ?? "", (c) =>
      expect(c.token).toBe(`${FAKE_PAT}2`),
    );
    expect(
      code(() =>
        t.floors.service.retryClone(t.owner, floor.floorId, repo?.repoId ?? "", undefined),
      ),
    ).toBe("409 repo_ready");
  });

  test("membership filters the list; viewers are capped at view; archive hides the floor", async () => {
    const t = setup();
    const { floor, cloned } = t.floors.service.create(t.owner, {
      name: "Team",
      tier: "small",
      repos: [{ repo: "octo/hello" }],
    });
    await cloned;
    const svc = t.floors.service;
    expect(svc.list(t.member)).toEqual([]);
    expect(svc.list(t.admin).map((f) => f.access)).toEqual(["manage"]);
    expect(code(() => svc.get(t.member, floor.floorId))).toBe("404 floor_not_found");

    svc.setMember(t.owner, floor.floorId, t.member.id, "spawn");
    svc.setMember(t.owner, floor.floorId, t.viewer.id, "manage");
    expect(svc.list(t.member).map((f) => f.access)).toEqual(["spawn"]);
    expect(svc.list(t.viewer).map((f) => f.access)).toEqual(["view"]);
    expect(code(() => svc.members(t.member, floor.floorId))).toBe("403 floor_manage_required");
    expect(code(() => svc.setMember(t.owner, floor.floorId, "ghost", "view"))).toBe(
      "404 user_not_found",
    );
    expect(svc.members(t.owner, floor.floorId)).toEqual([
      { userId: t.member.id, displayName: "Mia", access: "spawn" },
      { userId: t.viewer.id, displayName: "Vic", access: "manage" },
    ]);
    svc.setMember(t.owner, floor.floorId, t.member.id, "manage");
    svc.removeMember(t.member, floor.floorId, t.viewer.id);
    expect(svc.members(t.member, floor.floorId).map((m) => m.userId)).toEqual([t.member.id]);

    expect(code(() => svc.archive(t.member, floor.floorId))).toBe("403 owner_or_admin_required");
    svc.archive(t.admin, floor.floorId);
    expect(svc.list(t.owner)).toEqual([]);
    expect(svc.list(t.member)).toEqual([]);
    expect(t.changed.at(-1)).toBe(floor.floorId);
    const actions = t.db
      .select({ a: auditLog.action })
      .from(auditLog)
      .all()
      .map((r) => r.a);
    expect(actions).toEqual(
      expect.arrayContaining(["floor.member_set", "floor.member_remove", "floor.archive"]),
    );
  });

  test("clones interrupted by a restart resume", async () => {
    const t = setup();
    const { floor, cloned } = t.floors.service.create(t.owner, {
      name: "Resume",
      tier: "small",
      repos: [{ repo: "octo/hello" }],
    });
    await cloned;
    const repoId = floor.repos[0]?.repoId ?? "";
    t.db.update(floorRepos).set({ cloneStatus: "cloning" }).where(eq(floorRepos.id, repoId)).run();
    await t.floors.cloner.resumePending();
    expect(t.floors.repos.getRepo(repoId)?.cloneStatus).toBe("ready");
  });
});
